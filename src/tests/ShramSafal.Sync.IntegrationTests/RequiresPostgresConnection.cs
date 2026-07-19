// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Shared connection-resolution + reachability gate for every
/// <c>[Trait("Category","RequiresPostgres")]</c> suite (<see cref="SyncPushTenantScopeRealPostgresTests"/>,
/// <see cref="SyncPushLedgerDerivationRealPostgresTests"/>,
/// <see cref="LedgerDerivationSupersessionRealPostgresTests"/>,
/// <see cref="Labour.LabourMoneyInvariantsRealPostgresTests"/>).
///
/// <para>
/// <b>2026-07-19 CI-truthfulness fix.</b> Every one of these suites used to
/// SKIP — report a green pass via <c>Assert.True(true, someReason)</c> — the
/// moment native Postgres was unreachable. In CI that was ALWAYS: the
/// connection resolved by reading <c>appsettings.Development.json</c>
/// (<c>Database=agrisync_dev</c>) never matched the CI Postgres service's
/// only pre-existing database (<c>postgres</c>), so the initial probe
/// connection failed on every run and every [Fact] in these classes silently
/// asserted NOTHING while reporting "Passed". A test that claims to prove a
/// tenant-security or money invariant must never pass without having proved
/// it, so an unreachable/unconfigured connection now THROWS out of
/// <see cref="ResolveReachableConnectionOrThrowAsync"/> — xUnit reports the
/// [Fact] as FAILED (with this exception as the reason), never skipped.
/// </para>
///
/// <para>
/// <b>What stays skippable.</b> This resolver is used ONLY by the
/// <c>RequiresPostgres</c> category, which — per this project's own
/// convention (<c>feedback_avoid_docker_local_dev</c>: rely on native
/// Postgres :5433, not Docker, for local dev) and mirroring the existing
/// <c>ShramSafal.Admin.IntegrationTests</c> / <c>AdminTestFixture</c>
/// precedent — is expected to always have a reachable native Postgres. The
/// separate <c>RequiresDocker</c>/Testcontainers suites (which spin up their
/// OWN disposable Postgres container) and environment-probed tests like
/// <c>FfmpegAudioTranscoderTests</c> are untouched by this change and remain
/// legitimately skippable.
/// </para>
///
/// <para>
/// <b>Env var override.</b> <c>REQUIRES_POSTGRES_ROOT_CONN</c> — mirrors the
/// established <c>ADMIN_TESTS_ADMIN_ROOT_CONN</c> convention
/// (<c>AdminTestFixture</c>). CI sets it to the actually-provisioned service
/// container's own maintenance database (<c>postgres</c> — the only database
/// that image creates). Local dev, with no env var set, falls back to
/// reading <c>ShramSafalDb</c> from
/// <c>src/AgriSync.Bootstrapper/appsettings.Development.json</c>, which is
/// pinned explicitly to <c>agrisync_dev</c> (the real, migrated dev
/// database) — never the stale, un-migrated <c>agrisync</c> database that
/// sits beside it on the same cluster. Either way this connection is used
/// ONLY as a maintenance connection to <c>CREATE DATABASE</c> a fresh
/// per-test scratch database; it never reads or writes <c>agrisync_dev</c>
/// (or the CI service's <c>postgres</c> db) directly.
/// </para>
/// </summary>
internal static class RequiresPostgresConnection
{
    private const string EnvVarName = "REQUIRES_POSTGRES_ROOT_CONN";

    /// <summary>
    /// Resolves the maintenance/superuser connection string used to
    /// <c>CREATE DATABASE</c> the per-test scratch database, and PROVES it is
    /// actually reachable. Throws — never returns a "please skip me" signal —
    /// when no connection is configured or the server cannot be reached. The
    /// caller's [Fact]s must FAIL, not silently pass, when this suite cannot
    /// run.
    /// </summary>
    public static async Task<string> ResolveReachableConnectionOrThrowAsync()
    {
        var envConn = Environment.GetEnvironmentVariable(EnvVarName);
        var baseConn = !string.IsNullOrWhiteSpace(envConn) ? envConn : ResolveFromAppSettingsOrNull();

        if (baseConn is null)
        {
            throw new InvalidOperationException(
                "RequiresPostgres: no Postgres connection is configured. This suite asserts a tenant-security " +
                $"or money invariant and must FAIL rather than silently pass when it cannot run. Set the " +
                $"{EnvVarName} environment variable (as CI does), or provide ConnectionStrings:ShramSafalDb in " +
                "src/AgriSync.Bootstrapper/appsettings.Development.json (local dev).");
        }

        try
        {
            await using var probe = new NpgsqlConnection(baseConn);
            await probe.OpenAsync();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                "RequiresPostgres: could not reach native Postgres via the configured connection " +
                $"({ex.GetType().Name}: {ex.Message}). This suite asserts a tenant-security or money invariant " +
                "and must FAIL rather than silently pass when it cannot run. Ensure Postgres is reachable " +
                $"(native :5433 locally, or the CI service container), or set {EnvVarName} explicitly.", ex);
        }

        return baseConn;
    }

    private static string? ResolveFromAppSettingsOrNull()
    {
        var path = Path.Combine(RepoRoot(), "src", "AgriSync.Bootstrapper", "appsettings.Development.json");
        if (!File.Exists(path))
        {
            return null;
        }

        var cfg = new ConfigurationBuilder().AddJsonFile(path, optional: true).Build();
        var conn = cfg.GetConnectionString("ShramSafalDb");
        return string.IsNullOrWhiteSpace(conn) ? null : conn;
    }

    /// <summary>
    /// Walks up from the test bin dir to the repo root (the folder that holds
    /// the src/ tree). AppContext.BaseDirectory is
    /// .../src/tests/ShramSafal.Sync.IntegrationTests/bin/&lt;cfg&gt;/net10.0/.
    /// </summary>
    public static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "src")))
        {
            dir = dir.Parent;
        }
        return dir?.FullName ?? AppContext.BaseDirectory;
    }
}
