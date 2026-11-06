// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F36)
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace AgriSync.Bootstrapper.Configuration;

/// <summary>
/// Puts an explicit ceiling and explicit waits on every PostgreSQL connection string, through the Npgsql
/// connection-string builder (so the cap is in the string Npgsql actually parses, not only in a config key).
///
/// <para><b>Why.</b> Npgsql's pool defaults to 100 connections per distinct connection string and waits 15 s
/// for a free one. With the request-wide transactions each business request holds two connections, so a burst
/// is bounded only by the database's own <c>max_connections</c>, and when that is reached every request fails
/// at once (register F36). A cap below the server limit makes the overload queue and then fail one request at
/// a time with a clear timeout instead of exhausting the server.</para>
///
/// <para><b>Rules.</b> A value already written in the string is never overridden (an operator's explicit
/// choice wins). The defaults come from <c>Database:MaxPoolSize</c>, <c>Database:ConnectionTimeoutSeconds</c>
/// and <c>Database:CommandTimeoutSeconds</c>, so production can change them without a rebuild. A string Npgsql
/// cannot parse (for example the <c>OVERRIDE_VIA_ENVIRONMENT_VARIABLE</c> placeholder) is left as it is and
/// reported, never silently dropped.</para>
/// </summary>
public static class ConnectionPoolDefaults
{
    public const int DefaultMaxPoolSize = 40;
    public const int DefaultConnectionTimeoutSeconds = 15;
    public const int DefaultCommandTimeoutSeconds = 30;

    // Npgsql's own builder answers ContainsKey = true for every known key (it holds defaults), so "did the
    // operator write it" is asked of a plain key/value parse of the original text instead, over every spelling.
    private static readonly string[] MaxPoolKeys = ["Maximum Pool Size", "MaxPoolSize", "Max Pool Size"];
    private static readonly string[] TimeoutKeys = ["Timeout"];
    private static readonly string[] CommandTimeoutKeys = ["Command Timeout", "CommandTimeout"];

    /// <summary>
    /// Returns <paramref name="connectionString"/> with the pool cap and the timeouts set where the string does
    /// not already say. <paramref name="changed"/> is false when nothing needed adding.
    /// </summary>
    public static string Apply(
        string connectionString,
        int maxPoolSize,
        int connectionTimeoutSeconds,
        int commandTimeoutSeconds,
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

        return changed ? builder.ConnectionString : connectionString;
    }

    private static bool MentionsAny(System.Data.Common.DbConnectionStringBuilder written, string[] keys) =>
        keys.Any(written.ContainsKey);

    /// <summary>
    /// Rewrites every <c>ConnectionStrings:*</c> entry through <see cref="Apply"/> and registers the result as the
    /// last configuration source, so every reader of <c>GetConnectionString</c> (the contexts, the outbox, the
    /// analytics rail, the readers) sees the capped string. Returns the keys that could not be parsed.
    /// </summary>
    public static IReadOnlyList<string> ApplyToConfiguration(ConfigurationManager configuration, Action<string> warn)
    {
        var maxPool = configuration.GetValue("Database:MaxPoolSize", DefaultMaxPoolSize);
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
                var tuned = Apply(entry.Value, maxPool, connectSeconds, commandSeconds, out var changed);
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
