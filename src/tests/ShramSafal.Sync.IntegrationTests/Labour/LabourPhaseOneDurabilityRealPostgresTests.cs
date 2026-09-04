// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Labour V1 Task 6 (spec 2026-07-13-labour-attendance-approval-design) — the
/// machine proof of THE PHASE RULE (doctrine P1): <b>Phase 1 stores what the
/// farmer CONFIRMED; Phase 2 derives what the system INFERRED; neither may
/// impersonate the other.</b> Canonical data must never live in a best-effort
/// side-car.
///
/// <para><b>Why this suite exists.</b>
/// <see cref="CreateDailyLogHandler"/> persists in two phases. Phase 1
/// (<c>AddDailyLogAsync</c> + <c>AddAuditEventAsync</c> + — as of Task 6 —
/// <c>AddLabourAssignmentAsync</c>, then one <c>SaveChangesAsync</c>) is ATOMIC.
/// Phase 2 (<c>PersistSideCarAsync</c>) is BEST-EFFORT: all three of its
/// isolation branches catch <c>Exception</c>, log a warning and return normally.
/// Had canonical labour been staged in Phase 2, a failure would have been SILENT
/// and UNRECOVERABLE — the log commits, the labour rows vanish, and the
/// idempotency early-return then hands back the existing log on every retry, so
/// the side-car is never reached again. There is no backfill job, reconciliation
/// worker or re-derive endpoint anywhere in this system, so the farmer's labour
/// record would simply cease to exist behind a success message.</para>
///
/// <para><b>The two boundary tests are a matched pair.</b>
/// <list type="number">
/// <item><i>Phase-1 boundary</i> — a DB failure on the Phase-1 batch must leave
/// <c>daily_logs</c>, <c>audit_events</c> AND <c>labour_assignments</c> all
/// unchanged, and the same <c>ClientRequestId</c> must then succeed cleanly.
/// Farmer truth is atomic and retryable.</item>
/// <item><i>Inverse boundary</i> — a side-car failure must leave the DailyLog AND
/// its LabourAssignments durable and still return success. Inferred truth is
/// best-effort.</item>
/// </list>
/// Together they ARE the Phase Rule.</para>
///
/// <para><b>Native :5433, fail-loud (2026-07-19 CI-truthfulness contract).</b>
/// Tagged <c>[Trait("Category","RequiresPostgres")]</c>. If native Postgres is
/// unreachable, <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// THROWS out of <see cref="InitializeAsync"/> — the [Fact]s report FAILED,
/// never a silent skip. Each fact creates its OWN scratch database, applies the
/// full migration chain to it, and drops it on dispose — it never touches
/// <c>agrisync_dev</c> / <c>agrisync_dev_v2</c> data. Harness shape copied from
/// <c>LedgerDerivationSupersessionRealPostgresTests</c>; the handler runs as the
/// non-superuser <c>agrisync_app</c> role under an ambient transaction with the
/// tenant GUCs set, so FORCE-RLS genuinely applies and
/// <c>PersistSideCarAsync</c> takes its SAVEPOINT branch.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourPhaseOneDurabilityRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("dddd1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountId = Guid.Parse("dddd2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerUserId = Guid.Parse("dddd3333-3333-3333-3333-333333333333");
    private static readonly Guid PlotId = Guid.Parse("dddd4444-4444-4444-4444-444444444444");
    private static readonly Guid CropCycleId = Guid.Parse("dddd5555-5555-5555-5555-555555555555");

    /// <summary>Labour-ONLY voice blob — the convergence counterpart (6.6).</summary>
    private static readonly Guid LabourOnlyAiJobId = Guid.Parse("dddd6666-6666-6666-6666-666666666666");

    /// <summary>Rich multi-family voice blob — used by 6.5 and 6.7.</summary>
    private static readonly Guid RichAiJobId = Guid.Parse("dddd7777-7777-7777-7777-777777777777");

    // "आज ८ मजूर होते" — a headcount and nothing else. The manual counterpart in
    // the convergence test states exactly the same fact through the structured
    // payload, so any field the two paths disagree on is a real divergence.
    private const string LabourOnlyVoiceJson = """
    {
      "summary": "आज ८ मजूर होते",
      "dayOutcome": "WORK_RECORDED",
      "labour": [
        { "id": "lab-0", "engagementType": "hired_daily", "count": 8 }
      ]
    }
    """;

    // Multi-family blob: inputs (→ farm_operations + application_input_items),
    // irrigation, labour, machinery. The single-producer test proves the labour
    // branch alone is suppressed while every other family still derives.
    private const string RichVoiceJson = """
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
      ]
    }
    """;

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_labour_phase1_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw, FarmId, OwnerUserId, OwnerAccountId, "Labour Phase-1 Farm");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmId, OwnerUserId, OwnerAccountId, "PrimaryOwner", status: 3);
            await SeedPlotAsync(raw, PlotId, FarmId, "Plot A");
            await SeedCropCycleAsync(raw, CropCycleId, FarmId, PlotId, "Grapes", "Vegetative");
            await SeedAiJobAsync(raw, LabourOnlyAiJobId, FarmId, OwnerUserId, "labour-only-key", LabourOnlyVoiceJson);
            await SeedAiJobAsync(raw, RichAiJobId, FarmId, OwnerUserId, "rich-voice-key", RichVoiceJson);
        }

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

        // Real id generator / clock / ledger derivation; doubles ONLY for the two
        // collaborators orthogonal to this proof (entitlement gate + analytics).
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddScoped<ILedgerDerivationService, LedgerDerivationService>();

        // The REAL richness derivation, not a no-op. It is the LAST statement in
        // CreateDailyLogHandler.StageAndSaveSideCarAsync, i.e. inside the very
        // SAVEPOINT this suite exists to prove cannot take Phase 1 down with it.
        // A no-op double would shrink the side-car under test and turn the
        // durability proof into a proof about a smaller side-car than production
        // actually runs.
        services.AddScoped<IDailyRichnessDerivationService, DailyRichnessDerivationService>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

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

    // ─────────────────────────────────────────────────────────────────────────
    // 6.4 — THE PHASE-1 BOUNDARY. Farmer truth is atomic, and retryable.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <b>Failure mechanism, named.</b> A conflicting <c>ssf.labour_assignments</c>
    /// row carrying the SAME <c>LabourAssignmentId</c> is planted first, so the
    /// Phase-1 batch fails on <c>PK_labour_assignments</c> (<c>23505</c>).
    /// <c>ssf.labour_assignments</c> has no other unique index, so the primary key
    /// is the only natural failure surface.
    ///
    /// <para><b>The planted row hangs off a REAL second <c>ssf.daily_logs</c>
    /// row.</b> Task 1 added an FK on <c>daily_log_id</c>, so a random
    /// <c>daily_log_id</c> now raises <c>23503</c> at PLANT time instead of
    /// <c>23505</c> at SUBMIT time — the test would fail while setting itself up
    /// and prove nothing. Planting a real parent keeps the primary-key clash the
    /// ONLY violation at submit time.</para>
    /// </summary>
    [Fact]
    public async Task Phase_one_failure_leaves_no_log_no_audit_no_labour_and_the_same_client_request_id_retries_cleanly()
    {
        var plantedLogId = Guid.Parse("eeee1111-1111-1111-1111-111111111111");
        var targetLogId = Guid.Parse("eeee2222-2222-2222-2222-222222222222");
        var conflictAssignmentId = Guid.Parse("eeee3333-3333-3333-3333-333333333333");
        const string clientRequestId = "req-phase1-boundary";

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        // ── Plant a REAL second daily_log, then hang the conflicting labour row
        //    off it (see the [CORRECTED] rationale in the doc comment above). ──
        await PlantDailyLogAsync(read, plantedLogId);
        await PlantLabourAssignmentAsync(read, conflictAssignmentId, plantedLogId);

        var baselineLogs = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.daily_logs");
        var baselineAudit = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.audit_events");
        var baselineLabour = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.labour_assignments");

        // ── Submit the farmer's log carrying the COLLIDING assignment id. ──────
        var labour = new List<LabourItem>
        {
            new(LabourAssignmentId: conflictAssignmentId, EngagementType: "hired_daily", WorkerCount: 8),
        };

        var failed = await RunHandlerAsync(targetLogId, clientRequestId, sourceAiJobId: null, labour: labour);

        // RETARGETED 2026-08-28. This assertion used to require a raw Postgres
        // 23505 to escape the handler, because that is what actually happened: the
        // colliding client-minted assignment id reached PK_labour_assignments and
        // the unique violation surfaced as an exception.
        //
        // That is no longer the shape, and the change is the fix for a production
        // incident (device db658ce1, 2026-08-27). The raw 23505 was translated to
        // the generic "ShramSafal.SyncMutationStoreError", which the client
        // classifies RETRYABLE, so the phone re-sent identical bytes four times
        // against a payload no retry could ever satisfy.
        // CreateDailyLogHandler now REFUSES the contradiction before staging
        // anything, and names it.
        //
        // The property this test exists to defend is UNCHANGED and is asserted
        // below exactly as before: no log, no audit row, no labour row, and a
        // clean retry on the same ClientRequestId. Refusing earlier makes that
        // property strictly stronger — nothing is staged at all, so there is no
        // Phase-1 batch left to roll back.
        failed.Exception.Should().BeNull(
            "the collision is now refused before anything is staged, so no exception escapes the handler");
        failed.Result.Should().NotBeNull("the handler must return a verdict rather than throw");
        failed.Result!.IsSuccess.Should().BeFalse(
            "the log genuinely was not saved — P10 runs in both directions, so this must not be reported as success");
        failed.Result.Error!.Code.Should().Be("ShramSafal.LabourAssignment.Conflict",
            "the THREE segments are load-bearing: RejectionPolicy.normalizeCode keeps the tail after the LAST dot, "
            + "so this normalizes to CONFLICT, which every fielded client already treats as permanent. "
            + "A two-segment code would normalize to LABOURASSIGNMENTCONFLICT, miss PERMANENT_REJECTION_CODES, "
            + "and the phone would resume the retry loop this fix exists to stop.");

        // ── THE THREE COUNTS. All unchanged: log, audit row and labour rows share
        //    ONE unit of work, so either all three commit or none do. ───────────
        var afterLogs = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.daily_logs");
        var afterAudit = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.audit_events");
        var afterLabour = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.labour_assignments");

        afterLogs.Should().Be(baselineLogs,
            "daily_logs must be UNCHANGED — a half-written log with no labour is exactly the silent loss the Phase Rule forbids");
        afterAudit.Should().Be(baselineAudit, "audit_events must be UNCHANGED — it is staged in the same Phase-1 batch");
        afterLabour.Should().Be(baselineLabour, "labour_assignments must be UNCHANGED — only the planted conflict row remains");

        output.WriteLine("[EVIDENCE] === 6.4 Phase-1 boundary (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] refusal error code                 = {failed.Result!.Error!.Code} (expect ShramSafal.LabourAssignment.Conflict)");
        output.WriteLine($"[EVIDENCE] daily_logs          before/after    = {baselineLogs} / {afterLogs} (expect unchanged)");
        output.WriteLine($"[EVIDENCE] audit_events        before/after    = {baselineAudit} / {afterAudit} (expect unchanged)");
        output.WriteLine($"[EVIDENCE] labour_assignments  before/after    = {baselineLabour} / {afterLabour} (expect unchanged)");

        // ── Remove the conflict, retry with the SAME ClientRequestId. ──────────
        // The retry identity is what makes Phase-1 labour safe: nothing committed,
        // so the idempotency early-return finds nothing and the full write re-runs.
        await using (var del = read.CreateCommand())
        {
            del.CommandText = "DELETE FROM ssf.labour_assignments WHERE \"Id\" = @id";
            del.Parameters.AddWithValue("id", conflictAssignmentId);
            await del.ExecuteNonQueryAsync();
        }

        var retried = await RunHandlerAsync(targetLogId, clientRequestId, sourceAiJobId: null, labour: labour);
        retried.Exception.Should().BeNull("the retry must succeed once the conflict is gone");
        retried.Result!.IsSuccess.Should().BeTrue("the retry must return success");

        var retriedLogs = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", targetLogId));
        var retriedLabour = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", targetLogId));
        var retriedAssignmentId = (Guid)(await ScalarAsync(read,
            "SELECT \"Id\" FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", targetLogId)))!;

        retriedLogs.Should().Be(1, "exactly ONE DailyLog after the retry — the failed attempt left nothing behind");
        retriedLabour.Should().Be(1, "exactly ONE canonical set of LabourAssignments after the retry");
        retriedAssignmentId.Should().Be(conflictAssignmentId,
            "the client-supplied assignment id is the row's identity, so the retry rewrites the same row id");

        output.WriteLine($"[EVIDENCE] retry: daily_logs for target log     = {retriedLogs} (expect 1)");
        output.WriteLine($"[EVIDENCE] retry: labour_assignments for log    = {retriedLabour} (expect 1)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6.1 — RETRY IDENTITY IS MANDATORY once labour is canonical.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Structured labour with a blank <c>ClientRequestId</c> is rejected outright,
    /// writing nothing. Without a retry identity a retried submit is not deduped
    /// and produces a SECOND DailyLog and a SECOND canonical labour set. The key is
    /// deliberately NOT server-generated — a server-minted key is unique per
    /// attempt, so it would dedupe nothing and merely hide the duplicate.
    ///
    /// <para>This is asserted at the HANDLER, not over <c>/sync/push</c>: that
    /// transport already rejects a blank <c>clientRequestId</c> for every mutation
    /// type at the batch level, so a wire-level test would pass for the wrong
    /// reason and prove nothing about this guard.</para>
    ///
    /// <para>The narrowness is the point (doctrine P9 / plan Constraint 7). This
    /// and a <c>Guid.Empty</c> assignment id are the ONLY two ways structured
    /// labour may be rejected. Unrecognised enum strings map tolerantly and an
    /// absent/zero/negative duration falls back to <c>ServerAssumed</c> — no
    /// optional field may ever reject a farmer's record.</para>
    /// </summary>
    [Fact]
    public async Task Structured_labour_without_a_client_request_id_is_rejected_and_writes_nothing()
    {
        var logId = Guid.Parse("eeeebbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        var assignmentId = Guid.Parse("eeeecccc-cccc-cccc-cccc-cccccccccccc");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var run = await RunHandlerAsync(
            logId, clientRequestId: "   ", sourceAiJobId: null,
            labour: new List<LabourItem>
            {
                new(LabourAssignmentId: assignmentId, EngagementType: "hired_daily", WorkerCount: 8),
            });

        run.Exception.Should().BeNull("the guard must fail cleanly, not throw");
        run.Result!.IsSuccess.Should().BeFalse("structured labour without a retry identity must be rejected");
        run.Result.Error.Code.Should().Be("ShramSafal.InvalidCommand");

        var logs = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.daily_logs");
        var audit = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.audit_events");
        var labourRows = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.labour_assignments");

        logs.Should().Be(0, "zero DailyLog");
        audit.Should().Be(0, "zero AuditEvent");
        labourRows.Should().Be(0, "zero LabourAssignment");

        // A log WITHOUT structured labour keeps today's optional-ClientRequestId
        // contract unchanged — the guard must not have widened.
        var withoutLabour = await RunHandlerAsync(
            Guid.Parse("eeeedddd-dddd-dddd-dddd-dddddddddddd"),
            clientRequestId: "   ", sourceAiJobId: null, labour: null);
        withoutLabour.Exception.Should().BeNull();
        withoutLabour.Result!.IsSuccess.Should().BeTrue(
            "logs without structured labour must keep accepting a blank ClientRequestId exactly as before Task 6");

        output.WriteLine("[EVIDENCE] === 6.1 retry identity required for structured labour ===");
        output.WriteLine($"[EVIDENCE] rejected with labour, IsSuccess      = {run.Result.IsSuccess} (expect False)");
        output.WriteLine($"[EVIDENCE] daily_logs / audit_events / labour   = {logs} / {audit} / {labourRows} (expect 0/0/0)");
        output.WriteLine($"[EVIDENCE] accepted without labour, IsSuccess   = {withoutLabour.Result.IsSuccess} (expect True)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6.5 — THE INVERSE BOUNDARY. Inferred truth is best-effort.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <b>Mechanism:</b> a stub <see cref="ILedgerDerivationService"/> whose
    /// <c>DeriveAsync</c> throws, so the side-car fails DETERMINISTICALLY without
    /// touching the database. If canonical labour had been staged in the side-car,
    /// this test would find zero labour rows behind a success result — which is
    /// precisely the silent, unrecoverable loss Task 6 exists to prevent.
    /// </summary>
    [Fact]
    public async Task Side_car_failure_leaves_the_log_and_its_canonical_labour_durable_and_still_returns_success()
    {
        var logId = Guid.Parse("eeee4444-4444-4444-4444-444444444444");
        var assignmentId = Guid.Parse("eeee5555-5555-5555-5555-555555555555");

        var labour = new List<LabourItem>
        {
            new(LabourAssignmentId: assignmentId, EngagementType: "hired_daily", WorkerCount: 8, DurationHours: 6),
        };

        var run = await RunHandlerAsync(
            logId, "req-side-car-fails", sourceAiJobId: RichAiJobId, labour: labour,
            derivationOverride: new ThrowingLedgerDerivationService());

        run.Exception.Should().BeNull("a side-car failure must never propagate out of the handler");
        run.Result!.IsSuccess.Should().BeTrue(
            "the side-car is best-effort by contract — its failure must not reject the farmer's log");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var logRows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId));
        var labourRows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", logId));

        logRows.Should().Be(1, "the DailyLog is committed in Phase 1 and must survive a side-car failure");
        labourRows.Should().Be(1,
            "canonical labour is Phase-1 data and must survive a side-car failure EXACTLY as the log does — this is the whole point of Task 6");

        var row = await ReadSingleLabourRowAsync(read, logId);
        row.DurationHours.Should().Be(6m, "a stated duration survives as stated");
        row.TimeBasis.Should().Be("Explicit", "a stated duration is Explicit, never re-labelled Assumed");

        output.WriteLine("[EVIDENCE] === 6.5 inverse boundary (forced side-car failure) ===");
        output.WriteLine($"[EVIDENCE] handler result.IsSuccess             = {run.Result.IsSuccess} (expect True)");
        output.WriteLine($"[EVIDENCE] daily_logs for log                   = {logRows} (expect 1)");
        output.WriteLine($"[EVIDENCE] labour_assignments for log           = {labourRows} (expect 1)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6.6 — CONVERGENCE. One engagement, two entry paths, one shape.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The same real-world fact — "eight hired workers, no duration stated" —
    /// entered MANUALLY (structured <c>labour[]</c>, no <c>SourceAiJobId</c>) and
    /// by VOICE CONFIRM (an <c>AiJob</c> blob, sent WITHOUT structured labour so
    /// the legacy derivation path runs) must produce field-for-field identical
    /// rows. Both paths go through <c>LabourAssignmentFactory.FromParsed</c>; this
    /// proves the shared factory actually converges them rather than merely being
    /// called by both.
    /// </summary>
    [Fact]
    public async Task Manual_and_voice_confirmed_labour_converge_on_the_same_row_shape()
    {
        var manualLogId = Guid.Parse("eeee6666-6666-6666-6666-666666666666");
        var voiceLogId = Guid.Parse("eeee7777-7777-7777-7777-777777777777");
        var manualAssignmentId = Guid.Parse("eeee8888-8888-8888-8888-888888888888");

        // MANUAL — 8 workers, no duration stated, no source AiJob.
        var manual = await RunHandlerAsync(
            manualLogId, "req-manual", sourceAiJobId: null,
            labour: new List<LabourItem>
            {
                new(LabourAssignmentId: manualAssignmentId, EngagementType: "hired_daily", WorkerCount: 8),
            });
        manual.Exception.Should().BeNull();
        manual.Result!.IsSuccess.Should().BeTrue("the manual log must commit");

        // VOICE-CONFIRMED — the equivalent blob, sent WITHOUT structured labour so
        // the legacy derivation path is the producer.
        var voice = await RunHandlerAsync(
            voiceLogId, "req-voice", sourceAiJobId: LabourOnlyAiJobId, labour: null);
        voice.Exception.Should().BeNull();
        voice.Result!.IsSuccess.Should().BeTrue("the voice-confirmed log must commit");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var manualCount = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", manualLogId));
        var voiceCount = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", voiceLogId));
        manualCount.Should().Be(1, "the manual path must produce exactly one row");
        voiceCount.Should().Be(1, "the voice path must produce exactly one row");

        var manualRow = await ReadSingleLabourRowAsync(read, manualLogId);
        var voiceRow = await ReadSingleLabourRowAsync(read, voiceLogId);

        manualRow.EngagementType.Should().Be(voiceRow.EngagementType, "engagement_type must converge");
        manualRow.WorkerCount.Should().Be(voiceRow.WorkerCount, "worker_count must converge");
        manualRow.DurationHours.Should().Be(voiceRow.DurationHours, "duration_hours must converge");
        manualRow.TimeBasis.Should().Be(voiceRow.TimeBasis, "time_basis must converge");
        manualRow.MaleCount.Should().Be(voiceRow.MaleCount, "male_count must converge");
        manualRow.FemaleCount.Should().Be(voiceRow.FemaleCount, "female_count must converge");

        // Pin the converged shape itself, so a future change that breaks BOTH
        // paths identically can never pass this test.
        manualRow.EngagementType.Should().Be("Hired");
        manualRow.WorkerCount.Should().Be(8);
        manualRow.DurationHours.Should().Be(8m);
        manualRow.TimeBasis.Should().Be("Assumed", "neither path was told a duration, so both must say so honestly");
        manualRow.MaleCount.Should().BeNull("silence stays NULL — it is never asserted as zero");
        manualRow.FemaleCount.Should().BeNull("silence stays NULL — it is never asserted as zero");

        output.WriteLine("[EVIDENCE] === 6.6 convergence (manual vs voice-confirmed) ===");
        output.WriteLine($"[EVIDENCE] manual row = {manualRow}");
        output.WriteLine($"[EVIDENCE] voice  row = {voiceRow}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6.7 — SINGLE PRODUCER. One engagement, one row — the rest still derives.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// A voice confirm carrying BOTH a <c>SourceAiJobId</c> (whose blob contains
    /// <c>labour[]</c>) AND structured <c>labour[]</c> must produce EXACTLY ONE set
    /// of LabourAssignments — the structured one, which is what the farmer
    /// confirmed. That is what <c>deriveLabour: false</c> buys. It must suppress
    /// ONLY the labour branch: this test also asserts the same confirm's
    /// FarmOperation / input-item / irrigation / machinery derivation still occurs,
    /// so the guard can never quietly become an off-switch for the whole side-car.
    /// </summary>
    [Fact]
    public async Task Voice_confirm_with_structured_labour_produces_one_labour_set_and_still_derives_everything_else()
    {
        var logId = Guid.Parse("eeee9999-9999-9999-9999-999999999999");
        var structuredAssignmentId = Guid.Parse("eeeeaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

        // Deliberately DIFFERENT from the blob's labour entry (which is
        // hired_daily, 2 male / 3 female, rate 350) so the surviving row is
        // unambiguously the structured one, not a coincidental match.
        var run = await RunHandlerAsync(
            logId, "req-single-producer", sourceAiJobId: RichAiJobId,
            labour: new List<LabourItem>
            {
                new(LabourAssignmentId: structuredAssignmentId, EngagementType: "contract_piece", WorkerCount: 5),
            });

        run.Exception.Should().BeNull();
        run.Result!.IsSuccess.Should().BeTrue();

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var labourRows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", logId));
        labourRows.Should().Be(1,
            "one real engagement must be recorded ONCE — the derivation must not add a second row alongside the confirmed one");

        var row = await ReadSingleLabourRowAsync(read, logId);
        var survivingId = (Guid)(await ScalarAsync(read,
            "SELECT \"Id\" FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", logId)))!;
        survivingId.Should().Be(structuredAssignmentId,
            "the surviving row must be the FARMER-CONFIRMED structured one, not the inferred one");
        row.EngagementType.Should().Be("Contract", "the structured engagement type wins");
        row.WorkerCount.Should().Be(5, "the structured headcount wins");

        // ── the guard is labour-shaped, not a side-car off-switch ─────────────
        var farmOps = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_operations WHERE source_daily_log_id = @id", ("id", logId));
        var inputItems = await ScalarLongAsync(read, """
            SELECT COUNT(*)
            FROM ssf.application_input_items i
            JOIN ssf.farm_operations o ON o."Id" = i.operation_id
            WHERE o.source_daily_log_id = @id
            """, ("id", logId));
        var irrigation = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.irrigation_entries WHERE daily_log_id = @id", ("id", logId));
        var machinery = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.machinery_usages WHERE daily_log_id = @id", ("id", logId));

        farmOps.Should().Be(1, "the inputs branch must still derive its FarmOperation");
        inputItems.Should().Be(2, "both mix items must still derive");
        irrigation.Should().Be(1, "the irrigation branch must still derive");
        machinery.Should().Be(1, "the machinery branch must still derive");

        output.WriteLine("[EVIDENCE] === 6.7 single producer (SourceAiJobId + structured labour) ===");
        output.WriteLine($"[EVIDENCE] labour_assignments for log           = {labourRows} (expect 1)");
        output.WriteLine($"[EVIDENCE] surviving labour row is structured   = {survivingId == structuredAssignmentId} (expect True)");
        output.WriteLine($"[EVIDENCE] farm_operations for log              = {farmOps} (expect 1)");
        output.WriteLine($"[EVIDENCE] application_input_items for log      = {inputItems} (expect 2)");
        output.WriteLine($"[EVIDENCE] irrigation_entries for log           = {irrigation} (expect 1)");
        output.WriteLine($"[EVIDENCE] machinery_usages for log             = {machinery} (expect 1)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Real handler invocation under the ambient-transaction (SAVEPOINT) posture,
    // as agrisync_app with the tenant GUCs set. Mirrors
    // LedgerDerivationSupersessionRealPostgresTests.RunHandlerUnderSyncScopeAsync,
    // plus: it returns the THROWN exception instead of letting it escape, so the
    // Phase-1 boundary test can inspect the failure and roll the ambient
    // transaction back exactly as a failed request would.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record HandlerOutcome(Result<DailyLogDto>? Result, Exception? Exception);

    private async Task<HandlerOutcome> RunHandlerAsync(
        Guid dailyLogId,
        string clientRequestId,
        Guid? sourceAiJobId,
        IReadOnlyList<LabourItem>? labour,
        ILedgerDerivationService? derivationOverride = null)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

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
            sp.GetRequiredService<ILogger<CreateDailyLogHandler>>(),
            derivationOverride ?? sp.GetRequiredService<ILedgerDerivationService>(),
            sp.GetRequiredService<IDailyRichnessDerivationService>(),
            ctx);

        var command = new CreateDailyLogCommand(
            FarmId: FarmId,
            PlotId: PlotId,
            CropCycleId: CropCycleId,
            RequestedByUserId: OwnerUserId,
            OperatorUserId: OwnerUserId,
            LogDate: new DateOnly(2026, 8, 11),
            Location: null,
            DeviceId: "device-labour-phase1",
            ClientRequestId: clientRequestId,
            DailyLogId: dailyLogId,
            ActorRole: "owner",
            SourceAiJobId: sourceAiJobId,
            ClientAppVersion: "1.2.3",
            Labour: labour);

        try
        {
            var result = await handler.HandleAsync(command);
            await tx.CommitAsync();
            return new HandlerOutcome(result, null);
        }
        catch (Exception ex)
        {
            // A Phase-1 failure aborts the ambient transaction; a real request
            // would roll it back and report the failure to the client.
            await tx.RollbackAsync();
            return new HandlerOutcome(null, ex);
        }
    }

    /// <summary>Task 6.5 — fails the side-car deterministically, without touching the DB.</summary>
    private sealed class ThrowingLedgerDerivationService : ILedgerDerivationService
    {
        public Task<DerivationOutcome> DeriveAsync(
            ShramSafal.Domain.Logs.DailyLog log, ShramSafal.Domain.AI.AiJob sourceJob,
            IIdGenerator ids, IClock clock, bool deriveLabour = true, CancellationToken ct = default)
            => throw new InvalidOperationException("Task 6.5 — forced side-car derivation failure.");

        // Added by the main->dfes merge, which widened ILedgerDerivationService with the
        // manual-entry path. This stub exists to force a side-car failure, so BOTH derive
        // paths must throw — a manual path that quietly succeeded here would make the test
        // assert durability it never actually exercised.
        public Task<DerivationOutcome> DeriveFromManualDraftAsync(
            ShramSafal.Domain.Logs.DailyLog log, string manualWireJson, string? appVersion,
            IIdGenerator ids, IClock clock, bool deriveLabour, CancellationToken ct = default)
            => throw new InvalidOperationException("Task 6.5 — forced side-car derivation failure.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record LabourRow(
        string EngagementType, int? WorkerCount, decimal DurationHours,
        string TimeBasis, int? MaleCount, int? FemaleCount);

    private static async Task<LabourRow> ReadSingleLabourRowAsync(NpgsqlConnection db, Guid dailyLogId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT engagement_type, worker_count, duration_hours, time_basis, male_count, female_count
            FROM ssf.labour_assignments
            WHERE daily_log_id = @id
            """;
        cmd.Parameters.AddWithValue("id", dailyLogId);

        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue($"a labour row must exist for daily log {dailyLogId}");

        return new LabourRow(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetInt32(1),
            reader.GetDecimal(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetInt32(4),
            reader.IsDBNull(5) ? null : reader.GetInt32(5));
    }

    private static PostgresException? FindPostgresException(Exception ex)
    {
        for (Exception? current = ex; current is not null; current = current.InnerException)
        {
            if (current is PostgresException pg)
            {
                return pg;
            }
        }

        return null;
    }

    private static async Task PlantDailyLogAsync(NpgsqlConnection db, Guid dailyLogId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
            VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid, CURRENT_DATE, NOW(), 'voice', 'unknown', 'unknown');
            """;
        cmd.Parameters.AddWithValue("id", dailyLogId);
        cmd.Parameters.AddWithValue("fid", FarmId);
        cmd.Parameters.AddWithValue("pid", PlotId);
        cmd.Parameters.AddWithValue("cid", CropCycleId);
        cmd.Parameters.AddWithValue("uid", OwnerUserId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task PlantLabourAssignmentAsync(NpgsqlConnection db, Guid assignmentId, Guid dailyLogId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.labour_assignments
                ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis)
            VALUES
                (@id, @dlid, 'Hired', 4, 50, NULL, '[]'::jsonb, NOW(), 8, 'Assumed');
            """;
        cmd.Parameters.AddWithValue("id", assignmentId);
        cmd.Parameters.AddWithValue("dlid", dailyLogId);
        await cmd.ExecuteNonQueryAsync();
    }

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
