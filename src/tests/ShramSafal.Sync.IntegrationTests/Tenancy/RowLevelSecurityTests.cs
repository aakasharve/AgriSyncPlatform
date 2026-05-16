// spec: data-principle-spine-2026-05-05/03.4
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 03 Sub-phase 03.4 — cross-tenant
/// Row-Level Security integration tests. Pairs the 03.2
/// <c>TenantConnectionInterceptor</c> + <c>TenantContext</c> with the 03.3
/// <c>EnableRowLevelSecurity</c> migration and proves the end-to-end claim →
/// GUC → policy chain blocks cross-tenant reads at the Postgres layer.
///
/// <para>
/// <b>Test surface (per plan §03.4 + supervisor brief):</b>
/// <list type="number">
/// <item><b>Direct policy</b> — <c>daily_logs</c> query under Farm-A claim
/// returns Farm-A rows only; Farm-B rows are invisible.</item>
/// <item><b>TenantContext invariant</b> — re-setting the claim to a
/// different farm within the same scope throws (defends against the
/// "elevate then re-narrow" anti-pattern documented on
/// <see cref="TenantContext.SetTenant"/>).</item>
/// <item><b>Fail-closed</b> — querying without a claim throws from the
/// interceptor before SQL leaves the wire.</item>
/// <item><b>RLS-before-WHERE</b> — even an explicit
/// <c>WHERE farm_id = farmB</c> via <c>FromSqlRaw</c> returns empty
/// because RLS filters the policy expression first.</item>
/// <item><b>EXISTS-join policy</b> — <c>transcripts</c> has no
/// <c>farm_id</c>; its policy joins to <c>ai_jobs</c>. Verifies the
/// EXISTS-join honors the tenant boundary just like the direct policy.</item>
/// <item><b>Quoted "Id" farms policy</b> — <c>ssf.farms</c> keys on its
/// own quoted <c>"Id"</c>; verifies that special-case policy returns only
/// the current-tenant farm row.</item>
/// <item><b>Admin elevation</b> — <c>ElevateToAdminCrossTenant</c> makes
/// the interceptor skip GUC injection. Without <c>BYPASSRLS</c> on the
/// owner role (deferred to 03.5), <c>current_setting('agrisync.farm_id',
/// true)</c> returns NULL and the policy expression
/// <c>farm_id = NULL::uuid</c> yields zero rows. Documents this as the
/// 03.4 behavioural contract pending 03.5.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Docker gate.</b> Marked with both <c>[Collection("RequiresDocker")]</c>
/// (plan §03.4 L374 verbatim) and <c>[Trait("Category","RequiresDocker")]</c>
/// (the established CI filter shipped by sibling tests like
/// <see cref="DwcScoreMatviewTests"/>). Local Docker-less environments
/// skip; the GitHub Actions integration sweep runs them.
/// </para>
///
/// <para>
/// <b>Migration runner = container superuser.</b> Same as
/// <see cref="DwcScoreMatviewTests.ApplyFullMigrationChainAsync"/>. The
/// runner OWNS every table created by EF Core, but the 03.3 migration
/// applies <c>ALTER TABLE … FORCE ROW LEVEL SECURITY</c> on every farm-
/// scoped table, so even the table owner is subject to policy evaluation
/// — which is precisely what makes these tests meaningful when the test
/// process connects with the same superuser credentials.
/// </para>
///
/// <para>
/// <b>Transaction scoping.</b> Postgres scopes <c>set_config(name, value,
/// true)</c> (the <c>is_local = true</c> path used by
/// <see cref="TenantConnectionInterceptor"/>) to the current transaction.
/// Tests that issue queries after <see cref="TenantContext.SetTenant"/>
/// must wrap those queries in an explicit
/// <c>BeginTransactionAsync</c> — otherwise EF Core's per-command
/// auto-commit transaction expires the GUC before the next statement
/// runs. This mirrors what <see cref="TenantTransactionMiddleware"/>
/// does in production.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class RowLevelSecurityTests : IAsyncLifetime
{
    // Pin the postgres image the same way DwcScoreMatviewTests does. The
    // parameterless PostgreSqlBuilder() ctor is marked obsolete in
    // Testcontainers 4.x; suppress just this site so the project's
    // TreatWarningsAsErrors stays green.
#pragma warning disable CS0618 // Type or member is obsolete
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private ServiceProvider _rootProvider = default!;
    private Guid _farmA;
    private Guid _farmB;
    private Guid _ownerA;
    private Guid _ownerB;
    private Guid _ownerUserA;
    private Guid _ownerUserB;
    private Guid _aiJobA;
    private Guid _aiJobB;
    private Guid _transcriptA;
    private Guid _transcriptB;
    private Guid _attemptA;
    private Guid _attemptB;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();

        // ── Migration chain ─────────────────────────────────────────────
        // Mirror DwcScoreMatviewTests.ApplyFullMigrationChainAsync. Runs
        // as the testcontainer superuser; once 03.3's FORCE RLS lands the
        // owner still gets policy-checked when reading from this same
        // connection.
        await ApplyFullMigrationChainAsync(conn);

        // ── Seed two farms × two daily_logs each ────────────────────────
        _farmA = Guid.NewGuid();
        _farmB = Guid.NewGuid();
        _ownerA = Guid.NewGuid();
        _ownerB = Guid.NewGuid();
        _ownerUserA = Guid.NewGuid();
        _ownerUserB = Guid.NewGuid();

        await using (var raw = new NpgsqlConnection(conn))
        {
            await raw.OpenAsync();

            await SeedFarmAsync(raw, _farmA, _ownerUserA, "Farm A");
            await SeedFarmAsync(raw, _farmB, _ownerUserB, "Farm B");

            // Two daily_logs per farm so the count assertion is unambiguous.
            await InsertDailyLogAsync(raw, Guid.NewGuid(), _farmA, _ownerUserA, DateTime.UtcNow.AddDays(-1));
            await InsertDailyLogAsync(raw, Guid.NewGuid(), _farmA, _ownerUserA, DateTime.UtcNow);
            await InsertDailyLogAsync(raw, Guid.NewGuid(), _farmB, _ownerUserB, DateTime.UtcNow.AddDays(-1));
            await InsertDailyLogAsync(raw, Guid.NewGuid(), _farmB, _ownerUserB, DateTime.UtcNow);

            // One ai_job per farm and one transcript hanging off each job's
            // attempt — exercises the EXISTS-join policy on ssf.transcripts.
            _aiJobA = Guid.NewGuid();
            _aiJobB = Guid.NewGuid();
            _attemptA = Guid.NewGuid();
            _attemptB = Guid.NewGuid();
            _transcriptA = Guid.NewGuid();
            _transcriptB = Guid.NewGuid();

            await InsertAiJobAsync(raw, _aiJobA, _farmA, _ownerUserA, idempotencyKey: "rls-test-job-a");
            await InsertAiJobAsync(raw, _aiJobB, _farmB, _ownerUserB, idempotencyKey: "rls-test-job-b");
            await InsertAiJobAttemptAsync(raw, _attemptA, _aiJobA);
            await InsertAiJobAttemptAsync(raw, _attemptB, _aiJobB);
            await InsertTranscriptAsync(raw, _transcriptA, _aiJobA, _attemptA);
            await InsertTranscriptAsync(raw, _transcriptB, _aiJobB, _attemptB);
        }

        // ── DI graph — real AddShramSafalInfrastructure wiring ──────────
        // Resolves ShramSafalDbContext with the production interceptor
        // chain, including TenantConnectionInterceptor + scoped
        // TenantContext. This is the same wiring Program.cs uses; we just
        // point the connection string at the testcontainer.
        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = conn,
                ["ConnectionStrings:UserDb"] = conn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }
        await _pg.DisposeAsync();
    }

    // ────────────────────────────────────────────────────────────────────
    // 1. Direct-keyed policy — daily_logs filters to current tenant.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Daily_logs_query_returns_only_current_tenant_rows()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();

        tenant.SetTenant(_farmA, ownerAccountId: _ownerA);

        await using var tx = await ctx.Database.BeginTransactionAsync();
        var logs = await ctx.DailyLogs.AsNoTracking().ToListAsync();

        logs.Should().HaveCount(2, "Farm A was seeded with exactly two daily_logs");
        logs.Should().AllSatisfy(l =>
            l.FarmId.Value.Should().Be(_farmA,
                "RLS policy p_tenant_daily_logs must filter out Farm B's rows"));
    }

    // ────────────────────────────────────────────────────────────────────
    // 2. TenantContext invariant — reassignment to a DIFFERENT farm throws.
    //    See TenantContext.SetTenant XML doc: "Reassigning to a DIFFERENT
    //    farm within the same scope throws (catches cross-tenant data
    //    smuggling at handler-boundary level)."
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public void Switching_tenant_within_same_request_throws()
    {
        using var scope = _rootProvider.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();

        tenant.SetTenant(_farmA, ownerAccountId: _ownerA);

        Action act = () => tenant.SetTenant(_farmB, ownerAccountId: _ownerB);

        act.Should().Throw<InvalidOperationException>(
            "TenantContext refuses reassignment to a different farm within the same scope " +
            "to block cross-tenant data smuggling at handler-boundary level.");
    }

    // ────────────────────────────────────────────────────────────────────
    // 3. Fail-closed — querying without a claim throws from the interceptor.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Query_without_tenant_claim_throws()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        // DO NOT call SetTenant.

        await using var tx = await ctx.Database.BeginTransactionAsync();
        Func<Task> act = async () => await ctx.DailyLogs.AsNoTracking().ToListAsync();

        await act.Should().ThrowAsync<InvalidOperationException>(
            "TenantConnectionInterceptor must fail-closed when no claim is set and not in admin scope");
    }

    // ────────────────────────────────────────────────────────────────────
    // 4. RLS evaluates BEFORE the WHERE clause — explicit cross-farm filter
    //    still returns empty.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Direct_sql_with_other_farm_filter_still_returns_empty_under_RLS()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();

        tenant.SetTenant(_farmA, ownerAccountId: _ownerA);

        await using var tx = await ctx.Database.BeginTransactionAsync();
        var rowsForB = await ctx.DailyLogs
            .FromSqlRaw("SELECT * FROM ssf.daily_logs WHERE farm_id = {0}", _farmB)
            .AsNoTracking()
            .ToListAsync();

        rowsForB.Should().BeEmpty(
            "RLS policy filters BEFORE the WHERE clause — even an explicit cross-farm filter cannot escape it");
    }

    // ────────────────────────────────────────────────────────────────────
    // 5. EXISTS-join policy — transcripts honour their parent ai_job's
    //    farm boundary via EXISTS (SELECT 1 FROM ssf.ai_jobs j WHERE
    //    j.id = transcripts.ai_job_id AND j.farm_id = current_setting(...)).
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Transcripts_query_only_returns_current_tenant_via_ai_jobs_join()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();

        tenant.SetTenant(_farmA, ownerAccountId: _ownerA);

        await using var tx = await ctx.Database.BeginTransactionAsync();
        var transcripts = await ctx.Transcripts.AsNoTracking().ToListAsync();

        transcripts.Should().HaveCount(1,
            "exactly one transcript is reachable through Farm A's ai_job; Farm B's transcript must be filtered by p_tenant_transcripts");
        transcripts.Should().AllSatisfy(t =>
            t.AiJobId.Should().Be(_aiJobA,
                "the visible transcript must be the one anchored on Farm A's ai_job"));
    }

    // ────────────────────────────────────────────────────────────────────
    // 6. Quoted "Id" policy on ssf.farms — Phase 03.3 special-cased the
    //    farms table because its PK column is the case-sensitive quoted
    //    "Id" (raw-SQL CREATE TABLE in 20260222080909_AddAuditEvents).
    //    Unquoted `id` would resolve to a non-existent column.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Farms_query_only_returns_current_tenant_via_Id_keying()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();

        tenant.SetTenant(_farmA, ownerAccountId: _ownerA);

        await using var tx = await ctx.Database.BeginTransactionAsync();
        var farms = await ctx.Farms.AsNoTracking().ToListAsync();

        farms.Should().HaveCount(1,
            "p_tenant_farms keys on the quoted \"Id\" column; only Farm A must be visible to a Farm-A claim");
        farms.Should().AllSatisfy(f =>
            f.Id.Value.Should().Be(_farmA,
                "the surviving row must be the one whose \"Id\" equals the current_setting GUC"));
    }

    // ────────────────────────────────────────────────────────────────────
    // 7. Admin elevation — ElevateToAdminCrossTenant makes the interceptor
    //    skip GUC injection. Without BYPASSRLS on agrisync_owner (deferred
    //    to 03.5), current_setting('agrisync.farm_id', true) returns NULL
    //    and `farm_id = NULL::uuid` evaluates to NULL (treated as false by
    //    the policy USING clause), yielding zero rows. This documents the
    //    03.4 boundary: admin elevation skips the fail-closed guard but
    //    does NOT yet grant cross-tenant visibility until 03.5 lands the
    //    BYPASSRLS grant (or the planned IAdminDbContextFactory).
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Admin_elevation_skips_interceptor_but_RLS_still_returns_zero_rows_pending_03_5()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();

        // Must be called BEFORE any DB query — and BEFORE SetTenant, since
        // ElevateToAdminCrossTenant throws if FarmId is already set.
        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();
        var logs = await ctx.DailyLogs.AsNoTracking().ToListAsync();

        logs.Should().BeEmpty(
            "admin elevation correctly skips the interceptor's set_config prelude — but until 03.5 grants BYPASSRLS " +
            "on agrisync_owner (or installs IAdminDbContextFactory), the policy still applies and " +
            "`farm_id = NULL::uuid` filters out every row. Asserting zero rows pins the 03.4 contract; " +
            "the 03.5 follow-up test must flip this to assert all-tenant visibility.");
    }

    // ────────────────────────────────────────────────────────────────────
    // Migration chain + seeding helpers. Self-contained (mirrors
    // DwcScoreMatviewTests' inline-helper pattern §3.4 task-file boundary).
    // ────────────────────────────────────────────────────────────────────

    private static async Task ApplyFullMigrationChainAsync(string conn)
    {
        // User schema first (public.users).
        var userOpts = new DbContextOptionsBuilder<UserDbContext>().UseNpgsql(conn).Options;
        await using (var user = new UserDbContext(userOpts))
        {
            await user.Database.MigrateAsync();
        }

        // Accounts schema (accounts.*).
        var accountsOpts = new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(conn).Options;
        await using (var accounts = new AccountsDbContext(accountsOpts))
        {
            await accounts.Database.MigrateAsync();
        }

        // ShramSafal full chain — through 03.3 EnableRowLevelSecurity.
        // We bypass the interceptor chain on this DbContext because it's
        // only used to run migrations (which must execute without a tenant
        // claim). The production DI wiring will register a separate
        // DbContext with the interceptor for actual test queries.
        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn)
            .Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
        }
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db, Guid farmId, Guid ownerUserId, string name)
    {
        // ssf.farms — quoted "Id" column per 20260222080909_AddAuditEvents.
        // owner_account_id NOT NULL post-Phase 2 (TightenFarmOwnerAccountIdNotNull
        // 2026-04-18); reuse ownerUserId as a stand-in account id so the row
        // satisfies the NOT NULL without dragging in the full Accounts seed.
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        cmd.Parameters.AddWithValue("account", ownerUserId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertDailyLogAsync(
        NpgsqlConnection db,
        Guid logId,
        Guid farmId,
        Guid operatorId,
        DateTime createdAtUtc)
    {
        // Provenance columns are NOT NULL on daily_logs after 01.3
        // (AddProvenanceColumns step 7). Stamp pre_spine / unknown the same
        // way DwcScoreMatviewTests does — keeps the test honest about the
        // seed not flowing through the spine path.
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc,
                                         source, model_version, prompt_version)
            VALUES (@id, @fid, @plot, @cycle, @op, @date, @created,
                    'pre_spine', 'unknown', 'unknown');
            """;
        cmd.Parameters.AddWithValue("id", logId);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("plot", Guid.NewGuid());
        cmd.Parameters.AddWithValue("cycle", Guid.NewGuid());
        cmd.Parameters.AddWithValue("op", operatorId);
        cmd.Parameters.AddWithValue("date", createdAtUtc.Date);
        cmd.Parameters.AddWithValue("created", createdAtUtc);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertAiJobAsync(
        NpgsqlConnection db,
        Guid jobId,
        Guid farmId,
        Guid userId,
        string idempotencyKey)
    {
        // Provenance NOT NULL post-01.3; stamp pre_spine the same way.
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.ai_jobs (
                id, idempotency_key, operation_type, user_id, farm_id, status,
                schema_version, created_at_utc, total_attempts, modified_at_utc,
                source, model_version, prompt_version)
            VALUES (
                @id, @key, 'ParseVoice', @uid, @fid, 'Queued',
                '1.0.0', NOW(), 0, NOW(),
                'pre_spine', 'unknown', 'unknown');
            """;
        cmd.Parameters.AddWithValue("id", jobId);
        cmd.Parameters.AddWithValue("key", idempotencyKey);
        cmd.Parameters.AddWithValue("uid", userId);
        cmd.Parameters.AddWithValue("fid", farmId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertAiJobAttemptAsync(NpgsqlConnection db, Guid attemptId, Guid jobId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.ai_job_attempts (
                id, ai_job_id, attempt_number, provider, is_success, failure_class,
                latency_ms, attempted_at_utc, source, model_version, prompt_version)
            VALUES (
                @id, @job, 1, 'Sarvam', false, 'None',
                100, NOW(), 'pre_spine', 'unknown', 'unknown');
            """;
        cmd.Parameters.AddWithValue("id", attemptId);
        cmd.Parameters.AddWithValue("job", jobId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertTranscriptAsync(NpgsqlConnection db, Guid transcriptId, Guid aiJobId, Guid attemptId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.transcripts (
                id, ai_job_id, ai_job_attempt_id, text, language_tag, per_token_confidence, produced_at_utc)
            VALUES (
                @id, @job, @attempt, 'rls test transcript', 'mr-IN', '[]'::jsonb, NOW());
            """;
        cmd.Parameters.AddWithValue("id", transcriptId);
        cmd.Parameters.AddWithValue("job", aiJobId);
        cmd.Parameters.AddWithValue("attempt", attemptId);
        await cmd.ExecuteNonQueryAsync();
    }
}
