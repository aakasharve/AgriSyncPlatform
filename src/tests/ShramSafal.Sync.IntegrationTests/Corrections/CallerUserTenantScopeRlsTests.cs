// spec: 2026-08-25-prod-cutover-waves — ICallerUserTenantScope no longer hand-writes
// the tenant GUC; it admin-elevates (to silence TenantConnectionInterceptor's
// per-command SET LOCAL prepend, which desyncs EF's write rows-affected accounting)
// and then establishes agrisync.user_id through the shared
// AgriSync.BuildingBlocks.Persistence.RlsIdentityScope helper.
//
// AgriSync.ArchitectureTests.RlsIdentityScopeRules proves the SOURCE no longer contains
// a private set_config('agrisync.…'). It cannot prove the resulting connection is
// actually scoped — that is a fact about a running Postgres session, and a source scan
// asserting it would be theatre. This suite is the other half: it observes the GUC on
// the very session the work runs on, and then removes the scope and requires the
// database to refuse the write rather than let it land unscoped.
//
// [Trait("Category","RequiresPostgres")] — native :5433 (Docker-free), included in the
// CI merge-gate filter, self-skips cleanly when :5433 is unreachable. A skipped run
// proves nothing and reports Skipped, never Passed.

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Corrections;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Corrections;

[Trait("Category", "RequiresPostgres")]
public sealed class CallerUserTenantScopeRlsTests(CallerUserTenantScopeFixture fx)
    : IClassFixture<CallerUserTenantScopeFixture>
{
    private static readonly Guid Caller = Guid.Parse("c0eec002-0000-0000-0000-000000000001");
    private static readonly Guid Stranger = Guid.Parse("c0eec002-0000-0000-0000-000000000002");

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 0 — E3 GUARD. Every proof below is void if the role under test can
    // ignore row-level security: a superuser (or a BYPASSRLS role) satisfies any
    // policy, so "the write was refused" and "the write was allowed" would both
    // be measurements of the wrong thing. This runs first inside every proof,
    // and stands alone here so the guard itself is visible in the test list.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_0_the_connection_under_test_cannot_bypass_rls()
    {
        Skip.If(fx.Skip, fx.SkipReason);

        using var services = fx.NewScope();
        var db = services.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        var (currentUser, isSuper, bypassesRls) = await ReadRolePowersAsync(db);

        currentUser.Should().Be(
            "agrisync_app",
            "the proofs must run as the role the API actually connects as");
        isSuper.Should().BeFalse("a superuser is exempt from every policy in this suite");
        bypassesRls.Should().BeFalse("a BYPASSRLS role is exempt from every policy in this suite");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — the scope IS applied, and it is applied on the session the work
    // runs on. RlsIdentityScope sets agrisync.user_id with
    // set_config(..., is_local := true), which Postgres scopes to the CURRENT
    // transaction; read from any other connection, or outside that transaction,
    // it is absent. So the only honest place to observe it is from inside the
    // work callback, on the DbContext's own connection and transaction — which
    // is what this does.
    //
    // This is the assertion that would have caught a "fix" that merely deleted
    // the offending set_config to make the architecture gate green.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_1_the_scope_establishes_the_caller_on_the_session_the_work_runs_on()
    {
        Skip.If(fx.Skip, fx.SkipReason);

        using var services = fx.NewScope();
        var db = services.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await AssertOrdinaryRoleAsync(db);

        var scope = services.ServiceProvider.GetRequiredService<ICallerUserTenantScope>();

        var observed = await scope.RunForCallerAsync(
            Caller,
            async ct =>
            {
                db.Database.CurrentTransaction.Should().NotBeNull(
                    "an is_local setting outside a transaction is a silent no-op — the helper " +
                    "owning the transaction is half of what makes the scope real");

                return await ReadUserGucAsync(db, ct);
            });

        observed.Should().Be(
            Caller.ToString(),
            "p_user_correction_events resolves the caller from agrisync.user_id and nothing " +
            "else; if the GUC is absent the policy sees NULL and the work silently reads " +
            "nothing and writes nothing it is allowed to");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — WITHOUT the scope the write does NOT quietly run unscoped.
    //
    // This is the posture the endpoint would have if someone deleted the
    // RunForCallerAsync call: admin-elevated (so TenantConnectionInterceptor
    // stops fail-closing) but with no agrisync.user_id set. Elevation is not an
    // identity — it grants no visibility and emits no GUC — so the INSERT meets
    // a WITH CHECK of `user_id = NULL`, which is NULL, which is not TRUE, and
    // Postgres refuses the row with 42501.
    //
    // The refusal has to come from the SERVER. An application-level guard is a
    // guard someone can be talked out of; a policy is not.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_2_an_unscoped_write_is_refused_by_the_server_not_silently_accepted()
    {
        Skip.If(fx.Skip, fx.SkipReason);

        using var services = fx.NewScope();
        var db = services.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await AssertOrdinaryRoleAsync(db);

        // Elevate ONLY. This is deliberately the anti-pattern: silence the
        // interceptor's fail-closed guard and establish no identity at all.
        services.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        (await ReadUserGucAsync(db, CancellationToken.None)).Should().BeNullOrEmpty(
            "the premise of this proof is a session carrying no agrisync.user_id; if one " +
            "leaked in from elsewhere the refusal below would prove nothing");

        var parseId = Guid.NewGuid();
        db.CorrectionEvents.Add(NewCorrection(Caller, parseId));

        var write = async () => await db.SaveChangesAsync();

        var refusal = (await write.Should().ThrowAsync<DbUpdateException>(
            "an unscoped correction write must fail loudly, not land as an orphan row"))
            .Which;

        AssertRefusedByRlsPolicy(
            refusal,
            "the refusal must be the RLS WITH CHECK on ssf.correction_events, not an " +
            "application validation message");

        db.ChangeTracker.Clear();
        (await fx.CountByParseIdAsync(parseId)).Should().Be(
            0, "and nothing landed — verified as superuser, RLS-bypassed, so this is ground truth");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — the scope is a boundary, not a decoration. Under the caller's
    // own scope, a correction naming SOMEBODY ELSE cannot be written. This is
    // what makes it safe that the port runs no membership check: the database is
    // the arbiter of whose correction this is, so even an endpoint that was
    // wrong about the caller cannot file a correction in another farmer's name.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_3_a_correction_naming_another_user_cannot_be_written_under_my_scope()
    {
        Skip.If(fx.Skip, fx.SkipReason);

        using var services = fx.NewScope();
        var db = services.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await AssertOrdinaryRoleAsync(db);

        var scope = services.ServiceProvider.GetRequiredService<ICallerUserTenantScope>();
        var parseId = Guid.NewGuid();

        var write = async () => await scope.RunForCallerAsync(
            Caller,
            async ct =>
            {
                db.CorrectionEvents.Add(NewCorrection(Stranger, parseId));
                return await db.SaveChangesAsync(ct);
            });

        var refusal = (await write.Should().ThrowAsync<DbUpdateException>(
            "a row naming a user other than the established scope must be refused"))
            .Which;

        AssertRefusedByRlsPolicy(refusal, "the WITH CHECK compares user_id to the GUC");

        db.ChangeTracker.Clear();
        (await fx.CountByParseIdAsync(parseId)).Should().Be(0, "and nothing landed");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static CorrectionEvent NewCorrection(Guid userId, Guid parseId) =>
        CorrectionEvent.Record(
            userId,
            parseId,
            """{"note":"original"}""",
            """{"note":"corrected"}""",
            "v1",
            "mr-IN",
            CorrectionTrigger.EditUI);

    /// <summary>
    /// E3 — asserted BEFORE any other assertion in every proof. A vacuous RLS proof is
    /// worse than no proof, because it reports green.
    /// </summary>
    private static async Task AssertOrdinaryRoleAsync(ShramSafalDbContext db)
    {
        var (currentUser, isSuper, bypassesRls) = await ReadRolePowersAsync(db);

        isSuper.Should().BeFalse($"'{currentUser}' must not be a superuser for this proof to mean anything");
        bypassesRls.Should().BeFalse($"'{currentUser}' must not hold BYPASSRLS for this proof to mean anything");
    }

    private static async Task<(string CurrentUser, bool IsSuper, bool BypassesRls)> ReadRolePowersAsync(
        ShramSafalDbContext db)
    {
        await using var cmd = await OpenCommandAsync(db, CancellationToken.None);
        cmd.CommandText = "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user";

        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("current_user must resolve to a real role");
        return (reader.GetString(0), reader.GetBoolean(1), reader.GetBoolean(2));
    }

    /// <summary>
    /// Reads the GUC on the DbContext's OWN connection and current transaction — the only
    /// place a <c>set_config(..., is_local := true)</c> value is observable.
    ///
    /// <para>Absent has TWO representations and both must map to "not scoped".
    /// <c>current_setting(name, true)</c> returns SQL NULL on a session where the setting
    /// was never named at all, and the empty string on one where it was set and then
    /// reset — which is what a POOLED connection returning through Npgsql's
    /// <c>DISCARD ALL</c> looks like after an earlier test used it. Reading the NULL case
    /// as a plain string threw, and the empty case silently satisfied an
    /// "is it absent?" assertion that had never actually run against a virgin session.
    /// Collapsing both here is what lets the callers' premise checks mean what they
    /// say.</para>
    /// </summary>
    private static async Task<string?> ReadUserGucAsync(ShramSafalDbContext db, CancellationToken ct)
    {
        await using var cmd = await OpenCommandAsync(db, ct);
        cmd.CommandText = "SELECT current_setting('agrisync.user_id', true)";

        var raw = await cmd.ExecuteScalarAsync(ct);
        return raw is null or DBNull ? null : (string)raw;
    }

    /// <summary>
    /// A raw command on the context's connection, enlisted in its ambient transaction when
    /// there is one. Raw rather than EF on purpose: EF would route through
    /// <see cref="TenantConnectionInterceptor"/>, whose prepend is one of the things under
    /// test here, and an observation must not be altered by the thing it observes.
    /// </summary>
    private static async Task<DbCommand> OpenCommandAsync(ShramSafalDbContext db, CancellationToken ct)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(ct);
        }

        var cmd = connection.CreateCommand();
        cmd.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        return cmd;
    }

    /// <summary>
    /// <c>42501</c> alone is NOT enough. Postgres uses it for BOTH "new row violates
    /// row-level security policy" and "permission denied for table" — and the second is a
    /// missing GRANT, which is what took production down for twenty minutes on 2026-08-26
    /// (<c>42501: permission denied for table correction_events</c>). If this suite
    /// accepted a bare 42501 it would report green on a database where
    /// <c>agrisync_app</c> simply cannot write the table at all, and the isolation claim
    /// would be worth nothing. So the message text has to say it was the POLICY.
    /// </summary>
    private static void AssertRefusedByRlsPolicy(DbUpdateException ex, string because)
    {
        var pg = ex.InnerException as PostgresException;
        pg.Should().NotBeNull("the refusal must come from Postgres, not from application code");

        pg!.SqlState.Should().Be("42501", because);
        pg.MessageText.Should().Contain(
            "row-level security policy",
            "42501 is also 'permission denied for table' — a missing GRANT would satisfy a " +
            "bare SqlState check while proving the opposite of tenant isolation");
    }
}

/// <summary>
/// Scratch-DB-per-run fixture that builds the REAL production DI graph (Npgsql
/// <see cref="ShramSafalDbContext"/> + <see cref="TenantConnectionInterceptor"/> +
/// <c>ICallerUserTenantScope</c>) on the non-superuser <c>agrisync_app</c> role.
/// No farm or membership seeding: <c>ssf.correction_events</c> has no farm dimension.
/// </summary>
public sealed class CallerUserTenantScopeFixture : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private WebApplication? _app;
    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _rootConn = string.Empty;

    public bool Skip { get; private set; }
    public string SkipReason { get; private set; } = string.Empty;

    public IServiceScope NewScope() => _app!.Services.CreateScope();

    public async Task InitializeAsync()
    {
        _rootConn = IntegrationPostgres.ResolveRootConnection();

        // A genuinely ABSENT server self-skips; a server that answers and refuses us
        // throws — a misconfigured credential must never masquerade as a clean skip.
        var skipReason = await IntegrationPostgres.ProbeOrSkipReasonAsync(_rootConn);
        if (skipReason is not null)
        {
            Skip = true;
            SkipReason = skipReason;
            return;
        }

        _scratchDbName = $"ssf_caller_user_scope_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        var appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        _app = await BuildHostAsync(appConn);
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        if (!Skip && !string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_rootConn))
        {
            try
            {
                await using var admin = new NpgsqlConnection(_rootConn);
                await admin.OpenAsync();
                await using (var terminate = admin.CreateCommand())
                {
                    terminate.CommandText =
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
                    terminate.Parameters.AddWithValue("db", _scratchDbName);
                    await terminate.ExecuteNonQueryAsync();
                }
                await using var drop = admin.CreateCommand();
                drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
                await drop.ExecuteNonQueryAsync();
            }
            catch
            {
                // Best-effort teardown; a leaked scratch DB is harmless.
            }
        }
    }

    /// <summary>Ground truth — read as superuser, so RLS cannot hide a row that landed.</summary>
    public async Task<long> CountByParseIdAsync(Guid originalParseId)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM ssf.correction_events WHERE original_parse_id = @parse";
        cmd.Parameters.AddWithValue("parse", originalParseId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-caller-user-scope", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"caller-user-scope-analytics-{Guid.NewGuid()}"));
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        await app.StartAsync();
        return app;
    }
}
