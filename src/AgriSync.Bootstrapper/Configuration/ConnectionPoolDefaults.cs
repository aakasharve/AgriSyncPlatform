// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F36; fix round 1, H3)
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace AgriSync.Bootstrapper.Configuration;

/// <summary>
/// Gives every PostgreSQL connection string its own pool, an explicit ceiling and explicit waits, through the Npgsql
/// connection-string builder (so the cap is in the string Npgsql actually parses, not only in a config key).
///
/// <para><b>The request shape.</b> <c>TenantTransactionMiddleware</c> opens one transaction on EACH writing context
/// (ShramSafal first, then User) at the start of every business request, and a transaction owns its connection: a
/// request holds TWO connections, taken one after the other, for its whole life. That order (ShramSafal, then User) is the
/// only one in the code: the middleware is the only place that begins a transaction on both contexts (searched: every
/// other <c>BeginTransactionAsync</c> is on a single context). Auxiliary contexts (admin factory, accounts, analytics) are
/// taken after both and wait on nothing the request holds.</para>
///
/// <para><b>One pool per key (the fix for the self-deadlock).</b> Npgsql keys a pool on the whole connection string. The
/// documented production template gives <c>UserDb</c> and <c>ShramSafalDb</c> the SAME text, so both contexts drew from ONE
/// pool: with <c>N</c> slots, <c>N</c> simultaneous requests each took a first connection, every one then waited for a
/// second that nobody could give back, and all of them failed together after the wait. Each key now gets a distinct
/// <c>Application Name</c> (<c>agrisync-&lt;key&gt;</c>), so a request takes its first connection from the ShramSafal pool and its
/// second from the User pool. With the User pool at least as large as the ShramSafal pool, a request that holds a ShramSafal
/// connection can always get a User connection (only requests that already hold a ShramSafal connection hold User ones, and
/// they finish), so there is no cycle: when more than the cap arrive, the extra ones wait for the first connection and, if the wait
/// passes <see cref="DefaultConnectionTimeoutSeconds"/>, fail ALONE with Npgsql's pool timeout.</para>
///
/// <para><b>Sizing: the sum of every pool that can be open at once, plus the baseline, fits production's 76 usable
/// connections</b> (max_connections 79, 3 reserved; measured 2026-08-27). Idle baseline of other sessions: 12.
/// <list type="bullet">
/// <item><description>writing pools: <c>ShramSafalDb</c> 24 + <c>UserDb</c> 24 = 48 (<see cref="DefaultMaxPoolSize"/> each). The outbox
/// dispatcher and the jobs read the same strings, so they share these pools and add nothing.</description></item>
/// <item><description>auxiliary pools: every other key (<c>AccountsDb</c>, <c>AnalyticsDb</c>, <c>*_Migration</c>, <c>*_ReadOnly</c>; at most
/// 6 keys are configured) <see cref="DefaultAuxiliaryMaxPoolSize"/> = 2 each = 12.</description></item>
/// <item><description>48 + 12 = 60, plus the idle baseline 12 = 72, plus 4 spare for psql / deploy sessions = 76. Never above 76.</description></item>
/// </list>
/// A key with an explicit value in the string keeps it (an operator's choice wins); then the operator owns the arithmetic.</para>
///
/// <para><b>Other rules.</b> The defaults come from <c>Database:MaxPoolSize</c>, <c>Database:AuxiliaryMaxPoolSize</c>,
/// <c>Database:ConnectionTimeoutSeconds</c> and <c>Database:CommandTimeoutSeconds</c>, so production can change them without a
/// rebuild. A string Npgsql cannot parse (for example the <c>OVERRIDE_VIA_ENVIRONMENT_VARIABLE</c> placeholder) is left as it is
/// and reported, never silently dropped.</para>
/// </summary>
public static class ConnectionPoolDefaults
{
    /// <summary>Writing contexts: <c>ShramSafalDb</c> and <c>UserDb</c>, 24 each.</summary>
    public const int DefaultMaxPoolSize = 24;

    /// <summary>Every other key, 2 each.</summary>
    public const int DefaultAuxiliaryMaxPoolSize = 2;

    public const int DefaultConnectionTimeoutSeconds = 15;
    public const int DefaultCommandTimeoutSeconds = 30;

    /// <summary>Production's usable connections (max_connections 79 less 3 reserved).</summary>
    public const int ProductionUsableConnections = 76;

    /// <summary>Idle sessions that are not ours.</summary>
    public const int IdleBaseline = 12;

    /// <summary>The two keys a business request takes a connection from (the middleware's order: ShramSafal first, then User).</summary>
    public static readonly string[] WritingKeys = ["ShramSafalDb", "UserDb"];

    // Npgsql's own builder answers ContainsKey = true for every known key (it holds defaults), so "did the
    // operator write it" is asked of a plain key/value parse of the original text instead, over every spelling.
    private static readonly string[] MaxPoolKeys = ["Maximum Pool Size", "MaxPoolSize", "Max Pool Size"];
    private static readonly string[] TimeoutKeys = ["Timeout"];
    private static readonly string[] CommandTimeoutKeys = ["Command Timeout", "CommandTimeout"];
    private static readonly string[] ApplicationNameKeys = ["Application Name", "ApplicationName"];

    /// <summary>
    /// Returns <paramref name="connectionString"/> with the pool cap, the timeouts and a pool-separating Application Name set
    /// where the string does not already say. <paramref name="changed"/> is false when nothing needed adding.
    /// </summary>
    public static string Apply(
        string connectionString,
        int maxPoolSize,
        int connectionTimeoutSeconds,
        int commandTimeoutSeconds,
        string? applicationName,
        out bool changed)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        var written = new System.Data.Common.DbConnectionStringBuilder { ConnectionString = connectionString };
        changed = false;

        if (!MentionsAny(written, MaxPoolKeys))
        {
            builder.MaxPoolSize = maxPoolSize;
            changed = true;
        }

        if (!MentionsAny(written, TimeoutKeys))
        {
            builder.Timeout = connectionTimeoutSeconds;
            changed = true;
        }

        if (!MentionsAny(written, CommandTimeoutKeys))
        {
            builder.CommandTimeout = commandTimeoutSeconds;
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(applicationName) && !MentionsAny(written, ApplicationNameKeys))
        {
            builder.ApplicationName = applicationName;
            changed = true;
        }

        return changed ? builder.ConnectionString : connectionString;
    }

    private static bool MentionsAny(System.Data.Common.DbConnectionStringBuilder written, string[] keys) =>
        keys.Any(written.ContainsKey);

    /// <summary>The pool cap this key gets by default: writing keys <paramref name="writingMax"/>, every other key <paramref name="auxiliaryMax"/>.</summary>
    public static int CapFor(string key, int writingMax, int auxiliaryMax) =>
        WritingKeys.Contains(key, StringComparer.OrdinalIgnoreCase) ? writingMax : auxiliaryMax;

    /// <summary>
    /// The most connections the defaults can hold open at once for these keys, plus the idle baseline. Used by a test that fails
    /// if a default is raised past <see cref="ProductionUsableConnections"/>.
    /// </summary>
    public static int WorstCaseConnections(IEnumerable<string> keys, int writingMax, int auxiliaryMax) =>
        keys.Sum(k => CapFor(k, writingMax, auxiliaryMax)) + IdleBaseline;

    /// <summary>
    /// Rewrites every <c>ConnectionStrings:*</c> entry through <see cref="Apply"/> and registers the result as the
    /// last configuration source, so every reader of <c>GetConnectionString</c> (the contexts, the outbox, the
    /// analytics rail, the readers) sees the capped string. Returns the keys that could not be parsed.
    /// </summary>
    public static IReadOnlyList<string> ApplyToConfiguration(ConfigurationManager configuration, Action<string> warn)
    {
        var writingMax = configuration.GetValue("Database:MaxPoolSize", DefaultMaxPoolSize);
        var auxiliaryMax = configuration.GetValue("Database:AuxiliaryMaxPoolSize", DefaultAuxiliaryMaxPoolSize);
        var connectSeconds = configuration.GetValue("Database:ConnectionTimeoutSeconds", DefaultConnectionTimeoutSeconds);
        var commandSeconds = configuration.GetValue("Database:CommandTimeoutSeconds", DefaultCommandTimeoutSeconds);

        var overrides = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var unparsable = new List<string>();

        foreach (var entry in configuration.GetSection("ConnectionStrings").GetChildren())
        {
            if (string.IsNullOrWhiteSpace(entry.Value))
            {
                continue;
            }

            try
            {
                var tuned = Apply(
                    entry.Value,
                    CapFor(entry.Key, writingMax, auxiliaryMax),
                    connectSeconds,
                    commandSeconds,
                    "agrisync-" + entry.Key,
                    out var changed);
                if (changed)
                {
                    overrides[$"ConnectionStrings:{entry.Key}"] = tuned;
                }
            }
            catch (ArgumentException)
            {
                // Not a parsable Npgsql string (a placeholder or a malformed value). Leave it exactly as it was:
                // the code that opens it already fails loudly with its own message. Say so here so the cap is
                // never silently missing from a string we meant to cap.
                unparsable.Add(entry.Key);
                warn($"ConnectionStrings:{entry.Key} is not a parsable Npgsql connection string; pool cap not applied.");
            }
        }

        if (overrides.Count > 0)
        {
            configuration.AddInMemoryCollection(overrides);
        }

        return unparsable;
    }
}
