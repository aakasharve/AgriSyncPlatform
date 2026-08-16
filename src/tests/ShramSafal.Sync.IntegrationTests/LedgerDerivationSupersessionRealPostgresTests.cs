// spec: ai-intelligence-plan-2026-06-25
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Fix F2 (ai-intelligence-plan-2026-06-25) — the machine-gate proof for Fix F1
/// (two-phase persistence + supersession write-ordering) against REAL Npgsql on
/// native Postgres :5433 (NOT the EF-InMemory harness, NOT Docker). It exercises
/// the actual <see cref="CreateDailyLogHandler"/> +
/// <see cref="LedgerDerivationService"/> + real <c>ShramSafalRepository</c> +
/// real <c>ShramSafalDbContext</c> against a real partial-unique index
/// <c>ix_farm_operations_current_key</c> and real FORCE-RLS policies, connected
/// as the non-superuser <c>agrisync_app</c> role so RLS actually applies.
///
/// <para><b>Scenario (the offline RE-CONFIRM race the fix closes).</b> The
/// farmer confirms the SAME voice draft (same <c>SourceAiJobId</c>) twice with
/// DISTINCT <c>ClientRequestId</c>s. Because the idempotency key is
/// <c>DeviceId:ClientRequestId</c>, the second confirm is NOT deduped — the
/// handler runs fully again, creating a second DailyLog and re-deriving the
/// typed ledger. Both confirms target the SAME plot, so both derivations
/// recompute the SAME <see cref="Domain.Farms.DerivedEventKey"/> (keyed on the
/// AiJob id, plot scope, span text, and event type — NOT the log id), so the
/// second derivation must SUPERSEDE the first current FarmOperation, never insert
/// a second current row. (The plot scope in the key is the multi-plot collision
/// fix — DIFFERENT plots sharing one source job get DISTINCT keys and do NOT
/// supersede; this same-plot re-confirm still collides and supersedes.)</para>
///
/// <para><b>Four proofs (per the F2 brief).</b>
/// <list type="roman">
/// <item>Confirming twice leaves EXACTLY ONE <c>is_current_version</c>
/// FarmOperation per DerivedEventKey — supersession, no duplicate, no 23505
/// escaping the write-ordering fix.</item>
/// <item>The <c>daily_log</c> PERSISTS on BOTH confirms (never rolled back).</item>
/// <item>All relevant child-table families get rows:
/// <c>application_input_items</c> (via <c>farm_operations</c>);
/// <c>irrigation_entries</c> / <c>labour_assignments</c> /
/// <c>machinery_usages</c> / <c>observation_events</c> /
/// <c>disturbance_events</c> (via <c>daily_logs</c>).</item>
/// <item>A FORCED derivation failure does NOT roll back the log (non-blocking on
/// real Postgres — the SAVEPOINT branch of
/// <c>CreateDailyLogHandler.PersistSideCarAsync</c> un-aborts the ambient tx and
/// the Phase-1 log survives).</item>
/// </list></para>
///
/// <para><b>Write posture exercised — the /logs (GUC-SET) path.</b> This test
/// manually <c>set_config</c>s <c>agrisync.farm_id / owner_account_id /
/// user_id</c> (see <c>RunHandlerUnderSyncScopeAsync</c>) after admin-elevating
/// so <c>TenantConnectionInterceptor</c> no-ops (no <c>SET LOCAL</c> prepend →
/// no EF write-rows-affected desync, per
/// <c>reference_interceptor_setlocal_desyncs_ef_writes</c>). That GUC-SET
/// posture mirrors the single-tenant HTTP <c>POST /logs</c> path, where the
/// interceptor sets a real per-request farm GUC — NOT the production
/// <c>POST /sync/push</c> path. It ALSO opens an ambient transaction before
/// invoking the handler, so <c>dbContext.Database.CurrentTransaction</c> is
/// non-null → the handler takes the SYNC (SAVEPOINT) branch — the branch that
/// carries the supersession / rollback bug Fix F1 closes.</para>
///
/// <para><b>Caveat — production <c>/sync/push</c> sets NO farm GUC.</b> The
/// real <c>/sync/push</c> route is skip-listed in <c>TenantTransactionMiddleware</c>
/// and <c>PushSyncBatchHandler</c> never establishes the <c>agrisync.farm_id</c>
/// GUC, so on that live path the typed-ledger derivation is currently inert (the
/// parent tenant WITH CHECK rejects the write with the GUC unset). Wiring the
/// farm GUC into the <c>/sync/push</c> derivation is tracked as a SEPARATE
/// pre-flag-flip fix (spec <c>ai-intelligence-plan-2026-06-25</c>); this test
/// does not cover it.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Tagged
/// <c>[Trait("Category","RequiresPostgres")]</c> so it never runs in the
/// InMemory unit suite and stays out of the Docker-gated sweep. If native
/// Postgres :5433 is unreachable (no dev DB running) the fixture skips cleanly
/// rather than failing. It creates its OWN scratch database, applies the full
/// migration chain to it, and drops it on dispose — it never touches
/// <c>agrisync_dev</c> data.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LedgerDerivationSupersessionRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    // agrisync_app is created by migration 20260515090000_BootstrapDbRoles. Roles are
    // CLUSTER-global, so on a cluster where it already exists the migration is a no-op
    // and the live password is whatever it was rotated to — hence IntegrationPostgres
    // resolves it from AGRISYNC_TEST_APP_ROLE_PASSWORD, not a constant.
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("aaaa1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountId = Guid.Parse("aaaa2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerUserId = Guid.Parse("aaaa3333-3333-3333-3333-333333333333");
    private static readonly Guid PlotId = Guid.Parse("aaaa4444-4444-4444-4444-444444444444");
    private static readonly Guid CropCycleId = Guid.Parse("aaaa5555-5555-5555-5555-555555555555");
    private static readonly Guid AiJobId = Guid.Parse("aaaa6666-6666-6666-6666-666666666666");
    private static readonly Guid AttemptId = Guid.Parse("aaaa7777-7777-7777-7777-777777777777");

    // A rich voice blob exercising ALL SIX derived families: inputs (→
    // farm_operations + application_input_items), irrigation, labour, machinery,
    // observations, disturbance. The `sourceText` on inputs[0] anchors the
    // DerivedEventKey so both confirms recompute the same key.
    private const string VoiceJson = """
    {
      "summary": "फर्टिगेशन + मजूर + ट्रॅक्टर",
      "dayOutcome": "WORK_RECORDED",
      "inputs": [
        {
          "id": "in-0",
          "sourceText": "0:52:34 fertigation four kg",
          "type": "fertilizer",
          "mix": [
            { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" },
            { "id": "m1", "productName": "Calcium Nitrate", "dose": 2, "unit": "kg" }
          ]
        }
      ],
      "irrigation": [
        { "id": "irr-0", "role": "fertigation", "method": "drip", "source": "borewell", "durationHours": 2.5 }
      ],
      "labour": [
        { "id": "lab-0", "engagementType": "hired_daily", "maleCount": 2, "femaleCount": 3, "rate": 350 }
      ],
      "machinery": [
        { "id": "mac-0", "type": "tractor", "ownership": "owned", "hoursUsed": 1.5, "operationPerformed": "spraying" }
      ],
      "observations": [
        { "id": "obs-0", "noteType": "issue", "severity": "important", "textRaw": "पानावर बुरशी दिसली" }
      ],
      "disturbance": {
        "scope": "partial",
        "reason": "वीज गेली",
        "cause": "electricity",
        "severity": "medium"
      }
    }
    """;

    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _appConn = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        // ── Resolve the superuser connection (never echoed) ────────────────────
        var baseConn = IntegrationPostgres.ResolveRootConnection();

        // ── Reachability probe — an ABSENT server skips cleanly; a server that
        //    answers and REFUSES us throws, because a misconfigured credential
        //    reported as a skip is how an unexecuted proof reports green. ───────
        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        // ── Create an isolated scratch DB (never touches agrisync_dev data) ────
        _scratchDbName = $"ssf_f2_proof_{Guid.NewGuid():N}";
        var superuserBuilder = new NpgsqlConnectionStringBuilder(baseConn);
        var adminDbName = superuserBuilder.Database;
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        // Remember the admin DB so DisposeAsync can drop the scratch DB from it.
        _adminConn = baseConn;

        // ── Apply the FULL migration chain to the scratch DB (as superuser) ────
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // ── Seed parents as superuser (superuser bypasses RLS) ─────────────────
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw, FarmId, OwnerUserId, OwnerAccountId, "F2 Proof Farm");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmId, OwnerUserId, OwnerAccountId, "PrimaryOwner", status: 3);
            await SeedPlotAsync(raw, PlotId, FarmId, "Plot A");
            await SeedCropCycleAsync(raw, CropCycleId, FarmId, PlotId, "Grapes", "Vegetative");
            await SeedAiJobAsync(raw, AiJobId, FarmId, OwnerUserId, "f2-voice-key-1", VoiceJson);
            await SeedAiJobAttemptAsync(raw, AttemptId, AiJobId);
        }

        // ── Real Infrastructure DI, connected as agrisync_app (RLS applies) ────
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);

        // Collaborators the handler needs that live outside Infrastructure DI
        // (the Api layer registers them in production). The REAL implementations
        // are used for the deterministic ones (id generator, clock, ledger
        // derivation); test doubles stand in ONLY for the two collaborators
        // orthogonal to this proof (entitlement gate + analytics sink).
        // Registered AFTER AddShramSafalInfrastructure so last-in-wins for
        // IEntitlementPolicy (Infrastructure registers DefaultEntitlementPolicy).
        // Repository, DbContext, AiJobRepository remain the real Infra wiring.
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddScoped<ILedgerDerivationService, LedgerDerivationService>();
        // CreateDailyLogHandler gained the DFES richness side-car dependency
        // (spec: dfes-companion-2026-07-11); this hand-rolled container must
        // register it too or every test here fails at handler construction.
        services.AddScoped<IDailyRichnessDerivationService, DailyRichnessDerivationService>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();

        _rootProvider = services.BuildServiceProvider();
    }

    private string _adminConn = string.Empty;

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (!_skip && !string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_adminConn))
        {
            try
            {
                await using var admin = new NpgsqlConnection(_adminConn);
                await admin.OpenAsync();
                await using var terminate = admin.CreateCommand();
                terminate.CommandText =
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
                terminate.Parameters.AddWithValue("db", _scratchDbName);
                await terminate.ExecuteNonQueryAsync();
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

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.4) — <c>Assert.True(true, _skipReason)</c> used
    /// to report these proofs as PASSING on any runner without Postgres on :5433, having
    /// exercised nothing. <c>Skip.If</c> (Xunit.SkippableFact) reports the run as Skipped —
    /// visually and in exit-code terms distinct from both Passed and Failed — so a database-less
    /// run can never be read as proof the F2 supersession fix behaves.
    /// </summary>
    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THE PROOF — one test drives BOTH confirms and asserts (i)-(iii); a second
    // test proves (iv) the forced-failure isolation on real Postgres.
    // ─────────────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Confirming_twice_same_ai_job_supersedes_to_one_current_row_and_persists_both_logs_with_all_child_families()
    {
        // spec: dfes-companion-2026-07-11 (wave-1.4) — Assert.True(true, _skipReason) here used
        // to report this proof as PASSING on any runner without Postgres on :5433, having
        // exercised nothing. Skip.If (Xunit.SkippableFact) reports the run as Skipped instead.
        SkipIfPostgresUnavailable();

        var log1 = Guid.Parse("bbbb1111-1111-1111-1111-111111111111");
        var log2 = Guid.Parse("bbbb2222-2222-2222-2222-222222222222");

        // ── Confirm #1 — distinct ClientRequestId "req-A" ──────────────────────
        var r1 = await RunHandlerUnderSyncScopeAsync(log1, clientRequestId: "req-A");
        r1.IsSuccess.Should().BeTrue("first confirm must succeed");

        // ── Confirm #2 — SAME SourceAiJobId, DISTINCT ClientRequestId "req-B" ──
        // Distinct idempotency key → NOT deduped → full re-run → re-derivation →
        // same DerivedEventKey → supersession.
        var r2 = await RunHandlerUnderSyncScopeAsync(log2, clientRequestId: "req-B");
        r2.IsSuccess.Should().BeTrue("second confirm must succeed (offline re-confirm is non-blocking)");

        // ── SQL assertions under the tenant scope ──────────────────────────────
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        // Guard: the handler ran under agrisync_app (a NON-superuser without
        // BYPASSRLS), so FORCE ROW LEVEL SECURITY genuinely applied to its
        // reads/writes — this is not a superuser-vacuous pass. Prove it from the
        // catalog so the whole proof is anchored to a real RLS-gated write path.
        await using (var appCheck = new NpgsqlConnection(_appConn))
        {
            await appCheck.OpenAsync();
            var isSuper = Convert.ToBoolean(await ScalarAsync(appCheck,
                "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
            var role = Convert.ToString(await ScalarAsync(appCheck, "SELECT current_user"));
            isSuper.Should().BeFalse(
                "the app connection must be a NON-superuser, no-BYPASSRLS role so FORCE-RLS is real");
            output.WriteLine($"[EVIDENCE] handler write path ran as role='{role}', superuser_or_bypassrls={isSuper}");
        }

        // (i) EXACTLY ONE is_current_version FarmOperation per DerivedEventKey.
        var currentRowsPerKey = await ScalarLongAsync(read, """
            SELECT COALESCE(MAX(c), 0) FROM (
                SELECT COUNT(*) AS c
                FROM ssf.farm_operations
                WHERE farm_id = @farm AND is_current_version
                GROUP BY derived_event_key
            ) t
            """, ("farm", FarmId));
        currentRowsPerKey.Should().Be(1,
            "(i) supersession must leave exactly ONE current FarmOperation per DerivedEventKey — no duplicate current row, no 23505 escaping the write-ordering fix");

        var totalCurrent = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_operations WHERE farm_id = @farm AND is_current_version",
            ("farm", FarmId));
        totalCurrent.Should().Be(1, "(i) exactly one current row total (single input span → single key)");

        var supersededCount = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_operations WHERE farm_id = @farm AND NOT is_current_version",
            ("farm", FarmId));
        supersededCount.Should().Be(1,
            "(i) the first derivation's operation must be marked superseded (append-only history), not deleted");

        // (ii) The daily_log PERSISTS on BOTH confirms (never rolled back).
        var log1Exists = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", log1));
        var log2Exists = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", log2));
        log1Exists.Should().Be(1, "(ii) the first confirm's daily_log must be durable");
        log2Exists.Should().Be(1,
            "(ii) the second (re-confirm) daily_log must ALSO be durable — the supersession must NOT roll back the log");

        // (iii) All relevant child-table families get rows.
        // application_input_items via farm_operations (2 mix items on the CURRENT op).
        var inputItems = await ScalarLongAsync(read, """
            SELECT COUNT(*)
            FROM ssf.application_input_items i
            JOIN ssf.farm_operations o ON o."Id" = i.operation_id
            WHERE o.farm_id = @farm AND o.is_current_version
            """, ("farm", FarmId));
        inputItems.Should().Be(2,
            "(iii) application_input_items — both mix items hang off the CURRENT farm_operation");

        // The five daily_logs-children families, across BOTH logs (one each per confirm).
        var irrigation = await ChildCountAsync(read, "irrigation_entries", log1, log2);
        var labour = await ChildCountAsync(read, "labour_assignments", log1, log2);
        var machinery = await ChildCountAsync(read, "machinery_usages", log1, log2);
        var observations = await ChildCountAsync(read, "observation_events", log1, log2);
        var disturbance = await ChildCountAsync(read, "disturbance_events", log1, log2);

        irrigation.Should().Be(2, "(iii) irrigation_entries — one per confirmed log");
        labour.Should().Be(2, "(iii) labour_assignments — one per confirmed log");
        machinery.Should().Be(2, "(iii) machinery_usages — one per confirmed log");
        observations.Should().Be(2, "(iii) observation_events — one per confirmed log");
        disturbance.Should().Be(2, "(iii) disturbance_events — one per confirmed log");

        // Real observed counts for the F2 evidence record (paste-into-report).
        output.WriteLine("[EVIDENCE] === F2 supersession proof (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] current farm_operations per DerivedEventKey (max) = {currentRowsPerKey} (expect 1)");
        output.WriteLine($"[EVIDENCE] total CURRENT farm_operations              = {totalCurrent} (expect 1)");
        output.WriteLine($"[EVIDENCE] SUPERSEDED farm_operations                 = {supersededCount} (expect 1)");
        output.WriteLine($"[EVIDENCE] daily_logs present (log1={log1Exists}, log2={log2Exists})   (expect 1,1)");
        output.WriteLine($"[EVIDENCE] application_input_items on current op      = {inputItems} (expect 2)");
        output.WriteLine($"[EVIDENCE] irrigation_entries / labour_assignments    = {irrigation} / {labour} (expect 2/2)");
        output.WriteLine($"[EVIDENCE] machinery_usages / observation_events      = {machinery} / {observations} (expect 2/2)");
        output.WriteLine($"[EVIDENCE] disturbance_events                         = {disturbance} (expect 2)");
        output.WriteLine("[EVIDENCE] no 23505 raised across two confirms with same SourceAiJobId, distinct clientRequestId");
    }

    [SkippableFact]
    public async Task Forced_derivation_failure_does_not_roll_back_the_log_on_real_postgres()
    {
        SkipIfPostgresUnavailable();

        var logId = Guid.Parse("cccc1111-1111-1111-1111-111111111111");

        // Inject a DB-level failure INSIDE the side-car: a BEFORE-INSERT trigger
        // on ssf.farm_operations that raises. This makes the REAL derivation
        // write throw a Postgres error mid-side-car (the closest faithful analog
        // to the transient 23505 the fix targets), aborting the ambient tx unless
        // the SAVEPOINT branch un-aborts it. The Phase-1 log was committed to the
        // ambient tx BEFORE the side-car, so it must survive to the outer commit.
        await using (var admin = new NpgsqlConnection(_superuserConn))
        {
            await admin.OpenAsync();
            await using var trig = admin.CreateCommand();
            trig.CommandText = """
                CREATE OR REPLACE FUNCTION ssf.f2_fail_farm_op() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'F2 forced derivation failure (23505 stand-in)';
                END; $$ LANGUAGE plpgsql;
                DROP TRIGGER IF EXISTS f2_fail_farm_op_trg ON ssf.farm_operations;
                CREATE TRIGGER f2_fail_farm_op_trg BEFORE INSERT ON ssf.farm_operations
                    FOR EACH ROW EXECUTE FUNCTION ssf.f2_fail_farm_op();
                """;
            await trig.ExecuteNonQueryAsync();
        }

        try
        {
            var result = await RunHandlerUnderSyncScopeAsync(logId, clientRequestId: "req-fail");

            // (iv) The handler still reports success — the derivation failure is
            // non-blocking.
            result.IsSuccess.Should().BeTrue(
                "(iv) a forced derivation DB failure is non-blocking and must never reject the log");

            await using var read = new NpgsqlConnection(_superuserConn);
            await read.OpenAsync();

            var logExists = await ScalarLongAsync(read,
                "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId));
            logExists.Should().Be(1,
                "(iv) the daily_log is committed in Phase 1 BEFORE the side-car; a forced side-car failure must NOT roll it back on real Postgres");

            var opRows = await ScalarLongAsync(read,
                "SELECT COUNT(*) FROM ssf.farm_operations WHERE farm_id = @farm", ("farm", FarmId));
            opRows.Should().Be(0,
                "(iv) the side-car rolled back to its savepoint — no half-derived farm_operation leaked");

            output.WriteLine("[EVIDENCE] === F2 non-blocking proof (forced side-car failure, real Npgsql :5433) ===");
            output.WriteLine($"[EVIDENCE] handler result.IsSuccess               = {result.IsSuccess} (expect True)");
            output.WriteLine($"[EVIDENCE] daily_log survives forced failure       = {logExists} (expect 1)");
            output.WriteLine($"[EVIDENCE] farm_operations after savepoint rollback = {opRows} (expect 0)");
        }
        finally
        {
            await using var admin = new NpgsqlConnection(_superuserConn);
            await admin.OpenAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText =
                "DROP TRIGGER IF EXISTS f2_fail_farm_op_trg ON ssf.farm_operations; DROP FUNCTION IF EXISTS ssf.f2_fail_farm_op();";
            await drop.ExecuteNonQueryAsync();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Real handler invocation under the prod SYNC write path (ambient tx +
    // admin-elevate + manual GUCs). Mirrors CallerFarmTenantScope +
    // TenantTransactionMiddleware so the handler's PersistSideCarAsync takes the
    // SAVEPOINT-on-ambient-transaction branch — the branch the fix guards.
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<AgriSync.BuildingBlocks.Results.Result<ShramSafal.Application.Contracts.Dtos.DailyLogDto>>
        RunHandlerUnderSyncScopeAsync(Guid dailyLogId, string clientRequestId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

        // Admin-elevate → interceptor no-ops (no SET LOCAL desync); then set the
        // GUCs ourselves so RLS WITH CHECK / USING pass for this farm.
        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {OwnerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {FarmId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {OwnerAccountId.ToString()}, true)");

        var handler = new CreateDailyLogHandler(
            sp.GetRequiredService<IShramSafalRepository>(),
            sp.GetRequiredService<IIdGenerator>(),
            sp.GetRequiredService<IClock>(),
            sp.GetRequiredService<IEntitlementPolicy>(),
            sp.GetRequiredService<IAnalyticsWriter>(),
            sp.GetRequiredService<IAiJobRepository>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<CreateDailyLogHandler>>(),
            sp.GetRequiredService<ILedgerDerivationService>(),
            sp.GetRequiredService<IDailyRichnessDerivationService>(),
            ctx);

        var command = new CreateDailyLogCommand(
            FarmId: FarmId,
            PlotId: PlotId,
            CropCycleId: CropCycleId,
            RequestedByUserId: OwnerUserId,
            OperatorUserId: OwnerUserId,
            LogDate: new DateOnly(2026, 6, 20),
            Location: null,
            DeviceId: "device-f2",
            ClientRequestId: clientRequestId,
            DailyLogId: dailyLogId,
            ActorRole: "owner",
            SourceAiJobId: AiJobId,
            ClientAppVersion: "1.2.3");

        var result = await handler.HandleAsync(command);

        // Commit the ambient tx exactly as TenantTransactionMiddleware does at
        // request end — Phase-1 log + (on the happy path) the side-car rows.
        await tx.CommitAsync();
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers.
    // ─────────────────────────────────────────────────────────────────────────

    private static async Task<long> ScalarLongAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
        => Convert.ToInt64(await ScalarAsync(db, sql, args));

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }
        return await cmd.ExecuteScalarAsync();
    }

    private static Task<long> ChildCountAsync(NpgsqlConnection db, string table, Guid log1, Guid log2)
        => ScalarLongAsync(db,
            $"SELECT COUNT(*) FROM ssf.{table} WHERE daily_log_id = @l1 OR daily_log_id = @l2",
            ("l1", log1), ("l2", log2));

    private static async Task SeedFarmAsync(
        NpgsqlConnection db, Guid farmId, Guid ownerUserId, Guid ownerAccountId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmMembershipAsync(
        NpgsqlConnection db, Guid id, Guid farmId, Guid userId, Guid ownerAccountId, string role, int status)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        cmd.Parameters.AddWithValue("status", status);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPlotAsync(NpgsqlConnection db, Guid plotId, Guid farmId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @name, 1.0, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", plotId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("name", name);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCropCycleAsync(
        NpgsqlConnection db, Guid cycleId, Guid farmId, Guid plotId, string crop, string stage)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, @crop, @stage, @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", cycleId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("plot", plotId);
        cmd.Parameters.AddWithValue("crop", crop);
        cmd.Parameters.AddWithValue("stage", stage);
        cmd.Parameters.AddWithValue("start", new DateTime(2026, 1, 1));
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedAiJobAsync(
        NpgsqlConnection db, Guid jobId, Guid farmId, Guid userId, string idempotencyKey, string normalizedJson)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.ai_jobs (
                id, idempotency_key, operation_type, user_id, farm_id, status,
                schema_version, created_at_utc, total_attempts, modified_at_utc,
                source, model_version, prompt_version, transcript_schema_version,
                normalized_result_json)
            VALUES (
                @id, @key, 'VoiceToStructuredLog', @uid, @fid, 'Succeeded',
                '1.0.0', NOW(), 1, NOW(),
                'voice', 'gemini-2.5-flash', 'v3.2.0', '1.0.0',
                @json::jsonb);
            """;
        cmd.Parameters.AddWithValue("id", jobId);
        cmd.Parameters.AddWithValue("key", idempotencyKey);
        cmd.Parameters.AddWithValue("uid", userId);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("json", normalizedJson);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedAiJobAttemptAsync(NpgsqlConnection db, Guid attemptId, Guid jobId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.ai_job_attempts (
                id, ai_job_id, attempt_number, provider, is_success, failure_class,
                latency_ms, attempted_at_utc, source, model_version, prompt_version)
            VALUES (
                @id, @job, 1, 'Gemini', true, 'None',
                100, NOW(), 'voice', 'gemini-2.5-flash', 'v3.2.0');
            """;
        cmd.Parameters.AddWithValue("id", attemptId);
        cmd.Parameters.AddWithValue("job", jobId);
        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
