using System;
using System.IO;
using System.Net.Sockets;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Single source of truth for how a <c>[Trait("Category","RequiresPostgres")]</c>
/// fixture reaches the real :5433 cluster.
///
/// <para><b>Why this exists.</b> Every RequiresPostgres fixture used to resolve its
/// own root connection and hardcode the <c>agrisync_app</c> password. Two silent
/// failure modes followed, and both made an UNEXECUTED tenancy proof report green:
/// </para>
/// <list type="number">
///   <item><description>
///     The root connection was read from <c>appsettings.Development.json</c> ahead of
///     any environment variable. Once the rotated superuser password was scrubbed out
///     of that tracked file, every fixture resolved a placeholder credential against a
///     database name that no longer exists — and the catch-all around the probe
///     reported that as <i>"Postgres unreachable"</i>. 13 tests "passed" in 1 second
///     having created no scratch database and executed no assertion.
///   </description></item>
///   <item><description>
///     <c>agrisync_app</c> is created by migration
///     <c>20260515090000_BootstrapDbRoles</c> with the literal local-dev password
///     <c>dev_app_change_me</c> — but Postgres roles are CLUSTER-global, so on a
///     cluster where that role already exists the migration is a no-op and the real
///     password is whatever the developer rotated it to. The hardcoded constant then
///     fails to log in.
///   </description></item>
/// </list>
///
/// <para><b>The rules this class enforces.</b> Environment beats tracked config, so a
/// credential never has to live in git. And a probe distinguishes a server that is
/// genuinely absent (skip — a Docker-less laptop is a legitimate skip) from a server
/// that answered and REFUSED us (throw — a misconfiguration must be loud, because a
/// tenancy proof that silently skips is indistinguishable from one that passed).</para>
/// </summary>
internal static class IntegrationPostgres
{
    public const string AppRoleUser = "agrisync_app";

    /// <summary>
    /// The migration-time default. Correct on a FRESH cluster (CI service container),
    /// wrong on any cluster where the role pre-exists with a rotated password.
    /// </summary>
    private const string MigrationDefaultAppRolePassword = "dev_app_change_me";

    /// <summary>
    /// Password for the non-superuser <c>agrisync_app</c> role the FORCE-RLS proofs
    /// connect as. Overridable via <c>AGRISYNC_TEST_APP_ROLE_PASSWORD</c> for a cluster
    /// whose role password has been rotated; falls back to the migration default so CI's
    /// fresh container needs no configuration.
    /// </summary>
    public static string AppRolePassword =>
        Environment.GetEnvironmentVariable("AGRISYNC_TEST_APP_ROLE_PASSWORD") is { Length: > 0 } rotated
            ? rotated
            : MigrationDefaultAppRolePassword;

    /// <summary>
    /// Resolves the superuser connection used for maintenance (CREATE/DROP DATABASE),
    /// migration application, and RLS-bypassed ground-truth readback. Always normalised
    /// to the <c>postgres</c> maintenance database, which is guaranteed to exist.
    ///
    /// <para>Precedence — environment first, so no credential need ever be committed:</para>
    /// <list type="number">
    ///   <item><description><c>ADMIN_TESTS_ADMIN_ROOT_CONN</c> — set by ci-gate.yml / dotnet-ci.yml.</description></item>
    ///   <item><description><c>REQUIRES_POSTGRES_ROOT_CONN</c> — the local-dev equivalent.</description></item>
    ///   <item><description><c>appsettings.Development.json</c> → <c>ShramSafalDb</c> — legacy fallback,
    ///     which now carries a scrubbed placeholder password and therefore fails LOUDLY
    ///     rather than masquerading as an unreachable server.</description></item>
    /// </list>
    /// </summary>
    public static string ResolveRootConnection()
    {
        foreach (var name in new[] { "ADMIN_TESTS_ADMIN_ROOT_CONN", "REQUIRES_POSTGRES_ROOT_CONN" })
        {
            var env = Environment.GetEnvironmentVariable(name);
            if (!string.IsNullOrWhiteSpace(env))
            {
                return Maintenance(env);
            }
        }

        var appsettings = Path.Combine(RepoRoot(), "src", "AgriSync.Bootstrapper", "appsettings.Development.json");
        if (File.Exists(appsettings))
        {
            var conn = new ConfigurationBuilder().AddJsonFile(appsettings, optional: true).Build()
                .GetConnectionString("ShramSafalDb");
            if (!string.IsNullOrWhiteSpace(conn))
            {
                return Maintenance(conn);
            }
        }

        return "Host=localhost;Port=5433;Database=postgres;Username=postgres;Password=SET_VIA_ENV_OR_secrets_local_credentials_json";
    }

    private static string Maintenance(string conn) =>
        new NpgsqlConnectionStringBuilder(conn) { Database = "postgres" }.ConnectionString;

    /// <summary>
    /// Opens the root connection once.
    /// <returns>
    /// <c>null</c> when the suite may proceed, or a skip reason when the server is
    /// genuinely absent (no listener / DNS failure / connect timeout) — the legitimate
    /// "this laptop has no Postgres" case.
    /// </returns>
    /// <exception cref="InvalidOperationException">
    /// Thrown when the server ANSWERED and rejected us (bad password, no such role, no
    /// such database). That is a misconfigured harness, not an absent server, and it must
    /// fail the run: reporting it as a skip is precisely how ten never-executed RLS
    /// tenancy tests reported green.
    /// </exception>
    /// </summary>
    public static async Task<string?> ProbeOrSkipReasonAsync(string rootConn)
    {
        try
        {
            await using var probe = new NpgsqlConnection(rootConn);
            await probe.OpenAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            throw new InvalidOperationException(
                $"RequiresPostgres harness misconfigured: the server at :5433 answered and REFUSED the root " +
                $"connection (SQLSTATE {ex.SqlState}). This is NOT an unreachable server and must not be " +
                $"reported as a skip. Set ADMIN_TESTS_ADMIN_ROOT_CONN or REQUIRES_POSTGRES_ROOT_CONN to a " +
                $"working superuser connection (and AGRISYNC_TEST_APP_ROLE_PASSWORD if the agrisync_app role " +
                $"password has been rotated on this cluster).", ex);
        }
        catch (NpgsqlException ex) when (ex.InnerException is SocketException or TimeoutException)
        {
            return $"Native Postgres :5433 unreachable ({ex.InnerException!.GetType().Name}); RequiresPostgres proof skipped.";
        }
    }

    private static string RepoRoot()
    {
        // AppContext.BaseDirectory is .../src/tests/<project>/bin/<cfg>/net10.0/.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "src")))
        {
            dir = dir.Parent;
        }
        return dir?.FullName ?? AppContext.BaseDirectory;
    }
}
