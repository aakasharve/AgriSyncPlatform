// spec: data-principle-spine-2026-05-05/08.2
//
// Load-bearing integration test per DS-017 rule (e): seed PII rows
// (notes "Akash phone 9876543210", display name, transcript excerpt),
// run ErasureWorker, SELECT surviving rows, regex-grep against
// \d{10} + display-name allowlist + "Akash". Assert ZERO matches.
// Assert sentinel SystemActor.ErasedFarmer is in user_id columns.
// Assert KEEP fields (farm_id, plot_id, amount, etc.) survived.
// Assert per-row AuditEvent rows emitted with
// entityType="ErasureAnonymize" action="Applied".

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.2 / DS-017 rule (e) —
/// asserts the ErasureWorker honours the 5-rule ANONYMIZE contract.
///
/// <para>
/// The test seeds a single user across daily_logs + cost_entries +
/// log_tasks + correction_events + finance_corrections with PII
/// embedded in every free-text column (notes with "Akash phone
/// 9876543210", description with display name, reason with phone
/// number, transcript-like excerpt in correction_events). After the
/// worker runs, the surviving rows are read back and grep'd:
///
/// <list type="bullet">
/// <item>no <c>\d{10}</c> matches anywhere in scrubbed text columns</item>
/// <item>no display-name allowlist match anywhere</item>
/// <item>no "Akash" substring anywhere</item>
/// </list>
/// </para>
///
/// <para>
/// Also asserts every <c>user_id</c>-shaped column on the surviving
/// rows carries the <see cref="SystemActor.ErasedFarmer"/> sentinel.
/// </para>
///
/// <para>
/// <b>2026-07-19 addition (founder Decision 5, spec
/// 2026-07-13-labour-attendance-approval-design).</b> This test used to seed
/// NO worker names at all and assert only a row count for
/// <c>ssf.labour_assignments</c> and <c>ssf.workers</c>/<c>ssf.worker_assignments</c>
/// weren't seeded or asserted at all — false assurance for anything worker-
/// name-shaped. It now also seeds a real third-party worker name
/// (<see cref="WorkerRawName"/>) into <c>ssf.workers</c>,
/// <c>ssf.worker_assignments</c>, and <c>ssf.labour_assignments.worker_names_json</c>,
/// then asserts the name is scrubbed from all three and that the grep step
/// in section 4 below finds no trace of it anywhere. A Docker-runnable
/// twin of this exact scrub logic — <c>ErasureWorkerWorkerNameScrubRealPostgresTests</c>
/// (RequiresPostgres category, native Postgres, no Docker needed) — is the
/// one actually EXECUTED locally to prove the before/after failure claim,
/// since this file's own <c>RequiresDocker</c> category has no CI sweep
/// (see the class remark on <c>WorkerNameProjectorActivationTests</c>).
/// </para>
///
/// <para>
/// Docker-gated — same collection + trait as
/// <see cref="ShramSafal.Sync.IntegrationTests.Tenancy.RowLevelSecurityTests"/>.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class ErasureWorkerAnonymizationTest : IAsyncLifetime
{
#pragma warning disable CS0618 // PostgreSqlBuilder() ctor obsolete in 4.x — pin for parity with sibling tests.
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private ServiceProvider _rootProvider = default!;
    private Guid _farmId;
    private Guid _userId;
    private Guid _plotId;
    private Guid _cycleId;

    private const string DisplayName = "Akash Arve";
    private const string PhoneNumber = "9876543210";
    private const string TranscriptExcerpt = "Akash said the phone number is 9876543210";

    // 2026-07-19 addition (founder Decision 5, spec
    // 2026-07-13-labour-attendance-approval-design) — a genuine third-party
    // worker name, distinct from the farmer's own DisplayName above, seeded
    // into ssf.workers / ssf.worker_assignments / ssf.labour_assignments so
    // this test actually proves the new worker-name erasure disposition
    // instead of asserting only a row count.
    private const string WorkerRawName = "Sunil WorkerPiiName";
    private const string WorkerNormalizedName = "sunil workerpiiname";
    private Guid _workerId;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

        _farmId = Guid.NewGuid();
        _userId = Guid.NewGuid();
        _plotId = Guid.NewGuid();
        _cycleId = Guid.NewGuid();

        await SeedFixtureAsync(conn);

        var appConn = BuildAppRoleConnectionString(conn);
        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = appConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = conn,
                ["ConnectionStrings:UserDb"] = appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);
        // Voice Diary ship (voice-diary-e2e-2026-05-17 §B.18) — the
        // throwing PendingRetainedBlobStore stub is DELETED in this
        // envelope; replace with an in-memory fake so ErasureWorker
        // can complete its delete-retained-voice pass without booting
        // a LocalStack S3 sidecar. The fixture seeds no
        // voice_clips_retained rows, so the fake's
        // DeleteRetainedVoiceForUserAsync is a no-op — but the
        // registration must satisfy the IRetainedBlobStore dependency.
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null) await _rootProvider.DisposeAsync();
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task ErasureWorker_anonymizes_user_data_per_DS017_5_rule()
    {
        // ── 1. Enqueue an erasure request ────────────────────────────
        var requestId = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_pg.GetConnectionString()))
        {
            await seed.OpenAsync();
            await using var cmd = seed.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.erasure_requests
                    (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
                VALUES (@id, @uid, NULL, 0, NOW());
                """;
            cmd.Parameters.AddWithValue("id", requestId);
            cmd.Parameters.AddWithValue("uid", _userId);
            await cmd.ExecuteNonQueryAsync();
        }

        // ── 2. Run the worker — invoke RunPassAsync via reflection on
        //     the BackgroundService start path. Simpler: invoke an
        //     ErasureWorker.ExecuteAsync with a short cancellation so
        //     one pass completes. We instantiate a worker bound to a
        //     short-lived cancellation token; one pass is enough.
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var worker = new ErasureWorker(scopeFactory, NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var workerTask = worker.StartAsync(cts.Token);
        // Wait briefly for the first poll loop to run.
        await Task.Delay(TimeSpan.FromSeconds(3), CancellationToken.None);
        cts.Cancel();
        try { await workerTask; } catch (OperationCanceledException) { }

        // ── 3. Inspect surviving rows ────────────────────────────────
        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();

        // ErasureRequest itself should be Completed.
        var status = (int)(await ScalarAsync(raw,
            "SELECT status FROM ssf.erasure_requests WHERE id = @id",
            ("id", requestId)))!;
        status.Should().Be((int)ErasureStatus.Completed,
            "ErasureWorker must transition the request to Completed within one pass");

        // daily_logs: operator_user_id should be the sentinel, KEEP
        // fields (farm_id, plot_id) should still be present.
        var dailyLogOperator = (Guid)(await ScalarAsync(raw,
            "SELECT operator_user_id FROM ssf.daily_logs WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        dailyLogOperator.Should().Be(SystemActor.ErasedFarmer,
            "DS-017 rule (a): operator_user_id must be the ErasedFarmer sentinel");

        var dailyLogFarm = (Guid)(await ScalarAsync(raw,
            "SELECT farm_id FROM ssf.daily_logs LIMIT 1"))!;
        dailyLogFarm.Should().Be(_farmId, "DS-017 rule (c): farm_id is a KEEP field");

        // log_tasks: notes + deviation_note should be NULL (rule (b)).
        var notes = await ScalarAsync(raw,
            "SELECT notes FROM ssf.log_tasks WHERE notes IS NOT NULL");
        notes.Should().BeNull("DS-017 rule (b): log_tasks.notes must be NULLed");

        var devNote = await ScalarAsync(raw,
            "SELECT deviation_note FROM ssf.log_tasks WHERE deviation_note IS NOT NULL");
        devNote.Should().BeNull("DS-017 rule (b): log_tasks.deviation_note must be NULLed");

        // cost_entries: created_by_user_id should be the sentinel;
        // description should be empty; amount (KEEP) should survive.
        var costCreator = (Guid)(await ScalarAsync(raw,
            "SELECT created_by_user_id FROM ssf.cost_entries WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        costCreator.Should().Be(SystemActor.ErasedFarmer,
            "DS-017 rule (a): cost_entries.created_by_user_id must be the sentinel");

        var costDescription = (string)(await ScalarAsync(raw,
            "SELECT description FROM ssf.cost_entries WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        costDescription.Should().BeEmpty("DS-017 rule (b): cost_entries.description must be scrubbed");

        // correction_events: user_id should be sentinel.
        var correctionUser = (Guid)(await ScalarAsync(raw,
            "SELECT user_id FROM ssf.correction_events LIMIT 1"))!;
        correctionUser.Should().Be(SystemActor.ErasedFarmer,
            "DS-017 rule (a): correction_events.user_id must be the sentinel");

        // finance_corrections: corrected_by_user_id should be sentinel,
        // reason free-text should be the redaction marker.
        var corrUser = (Guid)(await ScalarAsync(raw,
            "SELECT corrected_by_user_id FROM ssf.finance_corrections LIMIT 1"))!;
        corrUser.Should().Be(SystemActor.ErasedFarmer);
        var corrReason = (string)(await ScalarAsync(raw,
            "SELECT reason FROM ssf.finance_corrections LIMIT 1"))!;
        corrReason.Should().NotContain(PhoneNumber);
        corrReason.Should().NotContain(DisplayName);

        // farm_operations (Track B table-1, D-T1-ERASURE): actor scrubbed to
        // sentinel; KEEP fields (farm_id, operation_type, derived_event_key) survive.
        var foCreator = (Guid)(await ScalarAsync(raw,
            "SELECT created_by_user_id FROM ssf.farm_operations WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        foCreator.Should().Be(SystemActor.ErasedFarmer,
            "D-T1-ERASURE: farm_operations.created_by_user_id must be the ErasedFarmer sentinel");

        var foType = (string)(await ScalarAsync(raw,
            "SELECT operation_type FROM ssf.farm_operations WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        foType.Should().Be("input", "D-T1-ERASURE: operation_type is a KEEP field (de-identified fact)");

        var foKey = (string)(await ScalarAsync(raw,
            "SELECT derived_event_key FROM ssf.farm_operations WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        foKey.Should().Be(new string('b', 64), "D-T1-ERASURE: derived_event_key is a KEEP field");

        // application_input_items (Track B child, D-T2-ERASURE): KEEP — the
        // de-identified farm facts SURVIVE erasure unchanged (no user_id column).
        var aiiCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.application_input_items WHERE operation_id = @opid",
            ("opid", _farmOperationId)))!);
        aiiCount.Should().Be(1, "D-T2-ERASURE: application_input_items survives erasure (KEEP, de-identified)");

        var aiiProduct = (string)(await ScalarAsync(raw,
            "SELECT product_name FROM ssf.application_input_items WHERE operation_id = @opid LIMIT 1",
            ("opid", _farmOperationId)))!;
        aiiProduct.Should().Be("Ethrel", "D-T2-ERASURE: input-item product_name (a de-identified fact) is KEPT");

        // event_links (Track B table-3, D-T3-ERASURE): KEEP — the structural link
        // SURVIVES erasure (no user_id column).
        var elCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.event_links WHERE from_operation_id = @opid",
            ("opid", _farmOperationId)))!);
        elCount.Should().Be(1, "D-T3-ERASURE: event_links survives erasure (KEEP, de-identified)");

        // irrigation_entries (Track B table-4, D-T4-ERASURE): KEEP — the daily_logs-child
        // SURVIVES erasure (no user_id column).
        var ieCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.irrigation_entries WHERE daily_log_id = @dlid",
            ("dlid", _dailyLogId)))!);
        ieCount.Should().Be(1, "D-T4-ERASURE: irrigation_entries survives erasure (KEEP, de-identified)");

        // labour_assignments (Track B table-5, D-T5-ERASURE): KEEP — survives erasure
        // (no user_id column); the no-multiply NULL total_cost is preserved.
        var laCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.labour_assignments WHERE daily_log_id = @dlid AND total_cost IS NULL",
            ("dlid", _dailyLogId)))!);
        laCount.Should().Be(1, "D-T5-ERASURE: labour_assignments survives erasure (KEEP) with total_cost still NULL");

        // labour_assignments.worker_names_json (2026-07-19 addition): NOT KEEP —
        // the farmer's own spoken free-text naming a third-party worker must be
        // scrubbed, same as any other free-text PII column in this file.
        var laWorkerNames = (string)(await ScalarAsync(raw,
            "SELECT worker_names_json::text FROM ssf.labour_assignments WHERE daily_log_id = @dlid",
            ("dlid", _dailyLogId)))!;
        laWorkerNames.Should().NotContain(WorkerRawName,
            "2026-07-19 manifest correction: worker_names_json is embedded PII, not a de-identified fact, and must be scrubbed");
        laWorkerNames.Should().Be("[]", "worker_names_json must be reset to the empty-array default, not left partially scrubbed");

        // ssf.workers (2026-07-19 addition): ANONYMIZE, not KEEP — name_raw/
        // name_normalized hold a real third-party name and must be scrubbed
        // in place. KEEP fields (farm_id, assignment_count, the row itself)
        // survive so ssf.worker_assignments is never orphaned.
        var workerNameRaw = (string)(await ScalarAsync(raw,
            "SELECT name_raw FROM ssf.workers WHERE \"Id\" = @wid", ("wid", _workerId)))!;
        workerNameRaw.Should().NotBe(WorkerRawName, "ssf.workers.name_raw must be scrubbed, not survive verbatim");
        workerNameRaw.Should().NotContain("Sunil");

        var workerNameNormalized = (string)(await ScalarAsync(raw,
            "SELECT name_normalized FROM ssf.workers WHERE \"Id\" = @wid", ("wid", _workerId)))!;
        workerNameNormalized.Should().NotContain("sunil");

        var workerFarmId = (Guid)(await ScalarAsync(raw,
            "SELECT farm_id FROM ssf.workers WHERE \"Id\" = @wid", ("wid", _workerId)))!;
        workerFarmId.Should().Be(_farmId, "ssf.workers.farm_id is a KEEP field");

        var workerAssignmentCount = (int)(await ScalarAsync(raw,
            "SELECT assignment_count FROM ssf.workers WHERE \"Id\" = @wid", ("wid", _workerId)))!;
        workerAssignmentCount.Should().Be(1, "ssf.workers.assignment_count is a KEEP field");

        // ssf.worker_assignments (2026-07-19 addition): KEEP — the link row
        // must NOT be orphaned/removed by the ssf.workers scrub above (that
        // is exactly why the disposition is sentinel-replace, not DELETE).
        var workerAssignmentsCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.worker_assignments WHERE worker_id = @wid AND daily_log_id = @dlid",
            ("wid", _workerId), ("dlid", _dailyLogId)))!);
        workerAssignmentsCount.Should().Be(1,
            "ssf.worker_assignments must survive the ssf.workers scrub unorphaned — it has no PII of its own");

        // machinery_usages (Track B table-6, D-T6-ERASURE): KEEP — survives erasure
        // (no user_id column); the structured equipment config is preserved.
        var muCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.machinery_usages WHERE daily_log_id = @dlid AND implement = 'blower' AND nozzles_active = 10",
            ("dlid", _dailyLogId)))!);
        muCount.Should().Be(1, "D-T6-ERASURE: machinery_usages survives erasure (KEEP) with structured config intact");

        // observation_events (Track B table-7, D-FREETEXT-PRESERVE): KEEP — the free-text
        // wisdom SURVIVES erasure UNCHANGED (must NOT be scrubbed to ErasedFarmer/null).
        var obsText = (string?)(await ScalarAsync(raw,
            "SELECT text_raw FROM ssf.observation_events WHERE daily_log_id = @dlid",
            ("dlid", _dailyLogId)));
        obsText.Should().Be("leaf curl after first rain",
            "D-FREETEXT-PRESERVE-2026-06-29: observation free-text is PRESERVED (KEEP), never scrubbed by erasure");

        // disturbance_events (Track B table-8, D-FREETEXT-PRESERVE): KEEP — the free-text reason
        // SURVIVES erasure UNCHANGED (must NOT be scrubbed to ErasedFarmer/null).
        var distReason = (string?)(await ScalarAsync(raw,
            "SELECT reason FROM ssf.disturbance_events WHERE daily_log_id = @dlid",
            ("dlid", _dailyLogId)));
        distReason.Should().Be("rain stopped spraying at noon",
            "D-FREETEXT-PRESERVE-2026-06-29: disturbance reason is PRESERVED (KEEP), never scrubbed by erasure");

        // weather_events (Track B table-9): KEEP — system weather data survives erasure (no user column).
        var weCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.weather_events WHERE event_type = 'HeavyRain'"))!);
        weCount.Should().Be(1, "weather_events survives erasure (KEEP) — system weather data, no PII to scrub");

        // routine_patterns (Track B table-10): KEEP — derived farm memory survives erasure (no user column).
        var rpCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.routine_patterns WHERE operation_type = 'irrigation'"))!);
        rpCount.Should().Be(1, "routine_patterns survives erasure (KEEP) — derived farm data, no PII to scrub");

        // weather_stamps (Track B table-11): KEEP — system weather snapshot survives erasure (no user column).
        var wsCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.weather_stamps WHERE daily_log_id = @dlid AND condition_text = 'Partly Cloudy'",
            ("dlid", _dailyLogId)))!);
        wsCount.Should().Be(1, "weather_stamps survives erasure (KEEP) — system weather data, no PII to scrub");

        // ── 4. Regex-grep every free-text column for PII residue ────
        // 2026-07-19 addition: also grep ssf.workers.name_raw/name_normalized
        // and ssf.labour_assignments.worker_names_json — the two NEW
        // worker-name surfaces this fix gives a real scrub disposition. A
        // test that only counted rows before could never have caught a
        // name surviving in either place.
        var phoneRegex = new Regex(@"\d{10}");
        var allTextSql = """
            SELECT description FROM ssf.cost_entries
            UNION ALL
            SELECT COALESCE(notes, '') FROM ssf.log_tasks
            UNION ALL
            SELECT COALESCE(deviation_note, '') FROM ssf.log_tasks
            UNION ALL
            SELECT reason FROM ssf.finance_corrections
            UNION ALL
            SELECT name_raw FROM ssf.workers
            UNION ALL
            SELECT name_normalized FROM ssf.workers
            UNION ALL
            SELECT worker_names_json::text FROM ssf.labour_assignments
            """;
        await using var grepCmd = raw.CreateCommand();
        grepCmd.CommandText = allTextSql;
        await using var rdr = await grepCmd.ExecuteReaderAsync();
        var allText = new List<string>();
        while (await rdr.ReadAsync())
        {
            allText.Add(rdr.GetString(0));
        }
        await rdr.CloseAsync();

        foreach (var t in allText)
        {
            phoneRegex.IsMatch(t).Should().BeFalse(
                $"DS-017 rule (b) test fixture: no 10-digit phone shape may survive scrubbing (offending value: \"{t}\")");
            t.Should().NotContain(DisplayName,
                "DS-017 rule (b): display-name strings must be scrubbed");
            t.Should().NotContain("Akash",
                "DS-017 rule (b): first-name token from the transcript excerpt must be scrubbed");
            t.Should().NotContain(WorkerRawName,
                "2026-07-19: the third-party worker's name must be scrubbed from every surface it reached");
            t.Should().NotContain("Sunil",
                "2026-07-19: the worker's first-name token must not survive anywhere");
        }

        // ── 5. Per-row audit assertion ──────────────────────────────
        var auditCountObj = await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ErasureAnonymize' AND action = 'Applied'");
        var auditCount = Convert.ToInt32(auditCountObj!);
        auditCount.Should().BeGreaterThan(0,
            "DS-017 rule (d): ErasureWorker must emit ErasureAnonymize/Applied AuditEvent rows for the anonymized tables");

        var completionCountObj = await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ErasureRequest' AND action = 'Completed'");
        Convert.ToInt32(completionCountObj!).Should().Be(1,
            "ErasureWorker must emit exactly one ErasureRequest/Completed audit row per processed request");

        // ── 6. SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 cascade assertions ──
        // The voice-spine cascade follows a DELETE manifest (vs the
        // ANONYMIZE manifest for the pre-spine tables above). Counts
        // match SeedVoiceSpineFixtureAsync's seed exactly.

        // ai_jobs: every row for the user is gone (cascade-deletes
        // ai_job_attempts + the Phase 1.1 transcript_* columns
        // embedded on the row).
        var aiJobsRemaining = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.ai_jobs WHERE user_id = @uid",
            ("uid", _userId)))!);
        aiJobsRemaining.Should().Be(0,
            "Task 3.4: every ssf.ai_jobs row for the target user must be deleted (5 seeded → 0 remaining)");

        // transcript_history: the 4 rows keyed on the user's audio
        // hashes are orphan-cleaned. None of the user's hashes
        // should survive.
        var historyRemainingForUser = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.transcript_history WHERE audio_content_hash = ANY(@hashes)",
            ("hashes", _seededAudioHashes.ToArray())))!);
        historyRemainingForUser.Should().Be(0,
            "Task 3.4: transcript_history rows for the user's audio hashes must be orphan-cleaned (4 seeded → 0 remaining)");

        // golden_set_candidate: both rows for the user are deleted.
        var goldenRemaining = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.golden_set_candidate WHERE user_id = @uid",
            ("uid", _userId)))!);
        goldenRemaining.Should().Be(0,
            "Task 3.4: every ssf.golden_set_candidate row for the target user must be deleted (2 seeded → 0 remaining)");
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        return await cmd.ExecuteScalarAsync();
    }

    // SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 cascade fixture knobs —
    // populated by SeedFixtureAsync so the test method can assert
    // exact counts post-erasure.
    private const int VoiceSpineAiJobCount = 5;
    private const int VoiceSpineGoldenCandidateCount = 2;
    private const int VoiceSpineTranscriptHistoryCount = 4;
    private readonly List<string> _seededAudioHashes = new();

    // Track B table-2 (D-T2-ERASURE): the seeded farm_operations Id so
    // the survival assertion can locate the child application_input_items row.
    private Guid _farmOperationId;

    // Track B table-4 (D-T4-ERASURE): the seeded daily_logs Id so the
    // irrigation_entries survival assertion can locate the child row.
    private Guid _dailyLogId;

    private async Task SeedFixtureAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@id, 'Test Farm', @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
                """;
            c.Parameters.AddWithValue("id", _farmId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        // daily_logs
        _dailyLogId = Guid.NewGuid();
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid, CURRENT_DATE, NOW(), 'pre_spine', 'unknown', 'unknown');
                """;
            c.Parameters.AddWithValue("id", _dailyLogId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("pid", _plotId);
            c.Parameters.AddWithValue("cid", _cycleId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        // log_tasks (one with notes PII, one with deviation_note PII)
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.log_tasks ("Id", daily_log_id, activity_type, notes, deviation_note, occurred_at_utc, execution_status, compliance_outcome)
                VALUES
                    (@id1, @lid, 'Spray', @notes, NULL, NOW(), 0, 0),
                    (@id2, @lid, 'Weed', NULL, @dev, NOW(), 0, 0);
                """;
            c.Parameters.AddWithValue("id1", Guid.NewGuid());
            c.Parameters.AddWithValue("id2", Guid.NewGuid());
            c.Parameters.AddWithValue("lid", _dailyLogId);
            c.Parameters.AddWithValue("notes", $"{DisplayName} phone {PhoneNumber}");
            c.Parameters.AddWithValue("dev", TranscriptExcerpt);
            await c.ExecuteNonQueryAsync();
        }

        // cost_entries (description carries the display name + phone)
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.cost_entries
                    ("Id", farm_id, plot_id, category_id, description, amount, currency_code, entry_date, created_at_utc, modified_at_utc, created_by_user_id, source, model_version, prompt_version, prompt_content_hash, app_version)
                VALUES
                    (@id, @fid, @pid, 'other', @desc, 100.00, 'INR', CURRENT_DATE, NOW(), NOW(), @uid, 'pre_spine', 'unknown', 'unknown', 'unknown', 'unknown');
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("pid", _plotId);
            c.Parameters.AddWithValue("desc", $"Paid {DisplayName} ({PhoneNumber})");
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        // correction_events
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.correction_events
                    ("Id", user_id, original_parse_id, original_parse_raw, corrected_parse, prompt_version, locale, trigger, captured_at_utc)
                VALUES
                    (@id, @uid, @opid, @raw::jsonb, @cor::jsonb, 'v1', 'mr-IN', 'EditUI', NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("uid", _userId);
            c.Parameters.AddWithValue("opid", Guid.NewGuid());
            c.Parameters.AddWithValue("raw", $"\"{TranscriptExcerpt}\"");
            c.Parameters.AddWithValue("cor", $"\"{TranscriptExcerpt}\"");
            await c.ExecuteNonQueryAsync();
        }

        // finance_corrections (reason carries display name + phone)
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.finance_corrections ("Id", cost_entry_id, original_amount, corrected_amount, currency_code, reason, corrected_by_user_id, corrected_at_utc, modified_at_utc)
                VALUES (@id, @ceid, 100.00, 80.00, 'INR', @reason, @uid, NOW(), NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("ceid", Guid.NewGuid());
            c.Parameters.AddWithValue("reason", $"Reason from {DisplayName} ({PhoneNumber})");
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        // farm_operations (Track B table-1) — owned by the target user.
        // ANONYMIZE manifest: created_by_user_id is scrubbed to the sentinel;
        // farm_id/operation_type/derived_event_key are KEEP fields.
        _farmOperationId = Guid.NewGuid();
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.farm_operations
                    ("Id", farm_id, plot_id, operation_type, operation_date, source_daily_log_id,
                     derived_event_key, is_current_version, created_by_user_id,
                     source, model_version, prompt_version,
                     created_at_utc, modified_at_utc)
                VALUES
                    (@id, @fid, @pid, 'input', CURRENT_DATE, NULL,
                     @key, true, @uid,
                     'voice', 'saaras:v3', 'v1',
                     NOW(), NOW());
                """;
            c.Parameters.AddWithValue("id", _farmOperationId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("pid", _plotId);
            c.Parameters.AddWithValue("key", new string('b', 64));
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        // application_input_items (Track B table-2, D-T2-ERASURE) — typed child
        // of farm_operations. No user_id/PII column: product_name, npk_grade,
        // dose_amount are de-identified farm facts. Seeded to assert KEEP survival.
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.application_input_items
                    ("Id", operation_id, product_name, npk_grade, dose_amount, ordinal, created_at_utc)
                VALUES
                    (@id, @opid, 'Ethrel', '00:52:34', 5, 0, NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("opid", _farmOperationId);
            await c.ExecuteNonQueryAsync();
        }

        // event_links (Track B table-3) — owned (via from_operation) by the target
        // user's farm. KEEP on erasure (no PII). Satisfies ck_event_links_one_target
        // (only to_operation_id set) + ck_event_links_same_farm (from=to farm).
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.event_links
                    ("Id", from_farm_id, to_farm_id, from_operation_id, to_operation_id,
                     to_cost_entry_id, link_kind, created_at_utc)
                VALUES
                    (@id, @fid, @fid, @fromop, @toop, NULL, 'CarrierFor', NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("fromop", _farmOperationId);
            c.Parameters.AddWithValue("toop", Guid.NewGuid());
            await c.ExecuteNonQueryAsync();
        }

        // irrigation_entries (Track B table-4) — child of the seeded daily log.
        // KEEP on erasure (no PII).
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.irrigation_entries
                    ("Id", daily_log_id, role, weather_adjusted, duration_hours, created_at_utc)
                VALUES
                    (@id, @dlid, 'Irrigation', false, 4, NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        // labour_assignments (Track B table-5) — child of the seeded daily log.
        // The engagement facts (worker_count/wage_per_person/total_cost) are
        // de-identified and KEEP on erasure. worker_names_json is NOT — it
        // carries the farmer's own spoken free-text naming a third-party
        // worker (2026-07-19 manifest correction) — seeded here with the PII
        // name so the post-erasure assertions can prove it is scrubbed.
        // total_cost intentionally NULL (no-multiply).
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis)
                VALUES
                    (@id, @dlid, 'Hired', 4, 50, NULL, @names::jsonb, NOW(), 8, 'Assumed');
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            c.Parameters.AddWithValue("names", $"[\"{WorkerRawName}\"]");
            await c.ExecuteNonQueryAsync();
        }

        // ssf.workers / ssf.worker_assignments (2026-07-19 addition) — a WTL
        // v0 Worker aggregate produced by WorkerNameProjector from THIS
        // user's own daily-log transcript, plus its link row. Third-party
        // PII (name_raw/name_normalized) that must be scrubbed — not KEEP —
        // when the operator who authored the log is erased.
        _workerId = Guid.NewGuid();
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.workers
                    ("Id", farm_id, name_raw, name_normalized, first_seen_utc, assignment_count)
                VALUES
                    (@id, @fid, @raw, @norm, NOW(), 1);
                """;
            c.Parameters.AddWithValue("id", _workerId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("raw", WorkerRawName);
            c.Parameters.AddWithValue("norm", WorkerNormalizedName);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.worker_assignments
                    ("Id", worker_id, daily_log_id, confidence, occurred_at_utc)
                VALUES
                    (@id, @wid, @dlid, 0.85, NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("wid", _workerId);
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        // machinery_usages (Track B table-6) — child of the seeded daily log.
        // KEEP on erasure (no PII); structured equipment config survives.
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.machinery_usages
                    ("Id", daily_log_id, machine_type, ownership, implement, nozzles_active, fan_state, created_at_utc)
                VALUES
                    (@id, @dlid, 'Sprayer', 'Owned', 'blower', 10, 'Off', NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        // observation_events (Track B table-7) — child of the seeded daily log.
        // KEEP on erasure (D-FREETEXT-PRESERVE-2026-06-29): the farmer's free-text wisdom survives UNCHANGED.
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.observation_events
                    ("Id", daily_log_id, note_type, severity, source, text_raw, created_at_utc)
                VALUES
                    (@id, @dlid, 'Observation', 'Normal', 'Voice', 'leaf curl after first rain', NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        // disturbance_events (Track B table-8) — child of the seeded daily log.
        // KEEP on erasure (D-FREETEXT-PRESERVE-2026-06-29): the farmer's free-text reason survives UNCHANGED.
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.disturbance_events
                    ("Id", daily_log_id, scope, reason, created_at_utc)
                VALUES
                    (@id, @dlid, 'Partial', 'rain stopped spraying at noon', NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        // weather_events (Track B table-9, DIRECT farm_id) — system weather data, no PII.
        // KEEP on erasure: a member's erasure must NOT delete farm-level weather history.
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.weather_events
                    ("Id", farm_id, event_type, severity, ts_start, source, created_at_utc)
                VALUES
                    (@id, @farmid, 'HeavyRain', 'High', NOW(), 'tomorrow.io_trigger', NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("farmid", _farmId);
            await c.ExecuteNonQueryAsync();
        }

        // routine_patterns (Track B table-10, DIRECT farm_id) — derived farm memory, no PII.
        // KEEP on erasure: a member's erasure must NOT delete the farm's routine memory.
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.routine_patterns
                    ("Id", farm_id, operation_type, sample_count, created_at_utc, updated_at_utc)
                VALUES
                    (@id, @farmid, 'irrigation', 5, NOW(), NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("farmid", _farmId);
            await c.ExecuteNonQueryAsync();
        }

        // weather_stamps (Track B table-11) — daily_logs child, system weather snapshot, no PII.
        // KEEP on erasure: a member's erasure must NOT delete the farm's weather snapshots.
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.weather_stamps
                    ("Id", daily_log_id, timestamp_local, timestamp_provider, provider,
                     temp_c, humidity, wind_kph, precip_mm, cloud_cover_pct,
                     condition_text, icon_code, rain_prob_next_6h, created_at_utc)
                VALUES
                    (@id, @dlid, NOW(), NOW(), 'TomorrowIo',
                     28.5, 65, 12, 0, 40, 'Partly Cloudy', 'partly_cloudy', 20, NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        await SeedVoiceSpineFixtureAsync(db);
    }

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 — seeds the voice-spine
    /// surfaces the cascade extension must walk:
    /// <list type="bullet">
    /// <item>5 <c>ssf.ai_jobs</c> rows, each with the Phase 1.1
    ///   transcript_* columns populated, each carrying a distinct
    ///   audio_content_hash recorded in <see cref="_seededAudioHashes"/>
    ///   for the post-erasure transcript_history assertion.</item>
    /// <item>4 <c>ssf.transcript_history</c> rows keyed on the first
    ///   4 of those hashes — the 5th hash has no history row, which
    ///   lets the test confirm that orphan-clean does not touch
    ///   unrelated rows.</item>
    /// <item>2 <c>ssf.golden_set_candidate</c> rows keyed on the
    ///   user_id + first 2 hashes (each with a distinct
    ///   correction_type so the unique index does not collapse them).</item>
    /// </list>
    /// We do NOT seed voice_clips_retained rows here — the existing
    /// <see cref="InMemoryRetainedBlobStore"/> fake covers that path
    /// without a LocalStack sidecar; an explicit seed would require
    /// the AES envelope shape, which is out of scope for the cascade
    /// test.
    /// </summary>
    private async Task SeedVoiceSpineFixtureAsync(NpgsqlConnection db)
    {
        var aiJobIds = new List<Guid>(VoiceSpineAiJobCount);
        for (var i = 0; i < VoiceSpineAiJobCount; i++)
        {
            var jobId = Guid.NewGuid();
            aiJobIds.Add(jobId);
            // 64-char hex audio_content_hash — deterministic per
            // seed-index so the test can re-derive the hash list
            // if needed.
            var hash = new string('a', 62) + i.ToString("X2");
            _seededAudioHashes.Add(hash);

            await using var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.ai_jobs (
                    id, idempotency_key, operation_type, user_id, farm_id, status,
                    input_content_hash, schema_version,
                    transcript_codemix, transcript_english, transcript_provider,
                    transcript_model_version, transcript_schema_version,
                    created_at_utc, modified_at_utc, total_attempts,
                    source, model_version, prompt_version, prompt_content_hash, app_version, extractor_code_sha
                )
                VALUES (
                    @id, @ikey, 'VoiceToStructuredLog', @uid, @fid, 'Succeeded',
                    @hash, '1.0.0',
                    @codemix, @english, 'Sarvam',
                    'saaras:v3', 'v1.0',
                    NOW(), NOW(), 1,
                    'voice', 'saaras:v3', 'v1', 'pcv1', 'app', 'sha'
                );
                """;
            c.Parameters.AddWithValue("id", jobId);
            c.Parameters.AddWithValue("ikey", $"idem-{i}");
            c.Parameters.AddWithValue("uid", _userId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("hash", hash);
            c.Parameters.AddWithValue("codemix", $"codemix transcript {i}");
            c.Parameters.AddWithValue("english", $"english transcript {i}");
            await c.ExecuteNonQueryAsync();
        }

        // 4 transcript_history rows keyed on the first 4 hashes.
        for (var i = 0; i < VoiceSpineTranscriptHistoryCount; i++)
        {
            await using var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.transcript_history (
                    id, audio_content_hash, transcript_provider,
                    transcript_model_version, transcript_mode, transcript_text,
                    produced_at_utc
                )
                VALUES (
                    @id, @hash, 'Sarvam', 'saaras:v3', 'codemix', @text, NOW()
                );
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("hash", _seededAudioHashes[i]);
            c.Parameters.AddWithValue("text", $"history text {i}");
            await c.ExecuteNonQueryAsync();
        }

        // 2 golden_set_candidate rows. Distinct correction_types so
        // the unique index on (audio_content_hash, correction_type)
        // does not reject the second insert.
        var correctionTypes = new[] { "value-correction", "structural-correction" };
        for (var i = 0; i < VoiceSpineGoldenCandidateCount; i++)
        {
            await using var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.golden_set_candidate (
                    id, audio_content_hash, user_id, farm_id,
                    bucket_id, correction_type,
                    ai_suggested_json, farmer_corrected_json,
                    promoted_to_golden_set, created_at_utc
                )
                VALUES (
                    @id, @hash, @uid, @fid,
                    'workDone', @ctype,
                    '{}'::jsonb, '{}'::jsonb,
                    false, NOW()
                );
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("hash", _seededAudioHashes[i]);
            c.Parameters.AddWithValue("uid", _userId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("ctype", correctionTypes[i]);
            await c.ExecuteNonQueryAsync();
        }
    }

    private static string BuildAppRoleConnectionString(string superuserConn)
    {
        var b = new NpgsqlConnectionStringBuilder(superuserConn)
        {
            Username = "agrisync_app",
            Password = TestRoleCredentials.AppRolePassword,
        };
        return b.ConnectionString;
    }

    private static async Task ApplyFullMigrationChainAsync(string conn)
    {
        var userOpts = new DbContextOptionsBuilder<UserDbContext>().UseNpgsql(conn).Options;
        await using (var user = new UserDbContext(userOpts))
        {
            await user.Database.MigrateAsync();
        }

        var accountsOpts = new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(conn).Options;
        await using (var accounts = new AccountsDbContext(accountsOpts))
        {
            await accounts.Database.MigrateAsync();
        }

        const string ssfPhaseATarget = "20260421075311_AlterCostEntriesAddJobCardId";
        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn).Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            var migrator = ssf.Database.GetService<IMigrator>();
            await migrator.MigrateAsync(ssfPhaseATarget);
        }

        var analyticsOpts = new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseNpgsql(conn, npgsql =>
            {
                npgsql.MigrationsAssembly(
                    typeof(AgriSync.Bootstrapper.Migrations.Analytics.AnalyticsRewrite).Assembly.FullName);
                npgsql.MigrationsHistoryTable(
                    tableName: "__analytics_migrations_history",
                    schema: AnalyticsDbContext.SchemaName);
            })
            .Options;
        await using (var analytics = new AnalyticsDbContext(analyticsOpts))
        {
            await analytics.Database.MigrateAsync();
        }

        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
        }
    }
}

/// <summary>
/// Voice Diary ship (voice-diary-e2e-2026-05-17 §B.18) — minimal
/// in-memory <see cref="IRetainedBlobStore"/> for the ErasureWorker
/// integration test. Replaces the deleted PendingRetainedBlobStore
/// stub. The fixture seeds zero <c>voice_clips_retained</c> rows so
/// <see cref="DeleteRetainedVoiceForUserAsync"/> finds nothing to
/// purge; the test only needs the DI registration to satisfy the
/// adapter dependency.
/// </summary>
internal sealed class InMemoryRetainedBlobStore : IRetainedBlobStore
{
    private readonly Dictionary<Guid, (VoiceClipRetained Meta, byte[] Cipher)> _store = new();

    public Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct)
    {
        var keys = _store
            .Where(kv => kv.Value.Meta.UserId == userId)
            .Select(kv => kv.Key)
            .ToList();
        foreach (var key in keys)
        {
            _store.Remove(key);
        }

        // This fake genuinely removes what it holds, so Deleted is the honest
        // answer when there was something to remove.
        return Task.FromResult(keys.Count == 0
            ? RetainedVoiceDeletionOutcome.NothingToDelete
            : RetainedVoiceDeletionOutcome.Deleted);
    }

    public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct)
    {
        _store[metadata.ClipId] = (metadata, cipherBytes);
        return Task.FromResult(metadata.ClipId);
    }

    public Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct)
    {
        if (_store.TryGetValue(clipId, out var entry) && entry.Meta.UserId == callerUserId)
        {
            return Task.FromResult<RetainedClipResult?>(new RetainedClipResult(
                ClipId: entry.Meta.ClipId,
                UserId: entry.Meta.UserId,
                RecordedAtUtc: entry.Meta.RecordedAtUtc,
                S3Key: entry.Meta.S3Key,
                DekId: entry.Meta.DekId,
                IvBase64: entry.Meta.IvBase64,
                AuthTagBase64: entry.Meta.AuthTagBase64,
                DurationSeconds: entry.Meta.DurationSeconds,
                Language: entry.Meta.Language,
                CipherBytes: entry.Cipher));
        }
        return Task.FromResult<RetainedClipResult?>(null);
    }

    public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
        Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var fromUtc = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var toUtc = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var rows = _store.Values
            .Where(e => e.Meta.UserId == userId
                        && e.Meta.RecordedAtUtc >= fromUtc
                        && e.Meta.RecordedAtUtc < toUtc)
            .OrderByDescending(e => e.Meta.RecordedAtUtc)
            .Select(e => new VoiceClipRetainedListItem(
                e.Meta.ClipId,
                e.Meta.RecordedAtUtc,
                e.Meta.DurationSeconds,
                e.Meta.Language,
                e.Meta.S3Key))
            .ToList();
        return Task.FromResult<IReadOnlyList<VoiceClipRetainedListItem>>(rows);
    }
}
