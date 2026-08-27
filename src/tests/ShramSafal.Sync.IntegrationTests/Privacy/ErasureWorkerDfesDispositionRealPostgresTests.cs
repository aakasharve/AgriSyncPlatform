// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Auditing;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Privacy;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// Founder ruling 2026-08-27 — proof, against a real Postgres, of the six
/// DFES / consent-gate / blob-linkage dispositions added to
/// <see cref="ErasureWorker"/>'s manifest.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this class exists at all.</b> Four of the six dispositions are KEEPs,
/// and a KEEP is carried by a comment. A comment cannot fail. The two that are
/// ACTIONS — <c>DELETE FROM ssf.raw_blob_subjects</c> and the
/// <c>ssf.labour_corrections</c> ANONYMIZE — are real SQL that has to execute
/// against the real schema, real FKs, real RLS and real column privileges, and
/// nothing short of running it proves it does. The manifest-coverage fitness
/// test (<c>AgriSync.ArchitectureTests.ErasureManifestCoverageTests</c>) only
/// asserts that each table is NAMED somewhere in ErasureWorker.cs; it would go
/// green on the comment alone. This suite is what stops that from being enough.
/// </para>
/// <para>
/// <b>RequiresPostgres, not RequiresDocker</b> — the same 2026-07-19
/// CI-truthfulness correction recorded on
/// <see cref="ErasureWorkerWorkerNameScrubRealPostgresTests"/>: no workflow
/// under <c>.github/workflows/</c> runs the <c>RequiresDocker</c> category, so
/// an erasure test placed there would prove nothing no matter how thorough its
/// assertions were. Fresh scratch database per run via
/// <c>IntegrationMigrationChain</c>, native Postgres on :5433, no Docker.
/// </para>
/// <para>
/// <b>Two subjects, one blob, one farm — deliberately.</b> Every assertion here
/// is paired: the erased user's row is gone or scrubbed, AND a second user's
/// row on the SAME blob and the SAME farm is untouched. A scrub that erases too
/// much passes a one-subject test and fails this one.
/// </para>
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class ErasureWorkerDfesDispositionRealPostgresTests : IAsyncLifetime
{
    private const string SharedBlobSha =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    private const string OtherBlobSha =
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcd9a";

    private const string ReviewerReason = "Ramesh told me only six came, not eight";
    private const string OtherReviewerReason = "second reviewer's words must survive";

    private const string KeptCrop = "Grapes";
    private const string KeptResponse = "Sulphur dusting done at berry-set, as every year";

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private ServiceProvider _provider = default!;

    private Guid _farmId;
    private Guid _erasedUserId;
    private Guid _otherUserId;
    private Guid _plotId;
    private Guid _cycleId;
    private Guid _dailyLogId;
    private Guid _labourAssignmentId;
    private Guid _erasedCorrectionId;
    private Guid _otherCorrectionId;
    private Guid _questionEventId;
    private Guid _richnessId;
    private Guid _termsEventId;
    private Guid _consentEventId;

    public async Task InitializeAsync()
    {
        // Throws (never skips) when Postgres is unconfigured/unreachable — same
        // CI-truthfulness contract as every other RequiresPostgres suite.
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_erasure_dfes_disposition_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        _farmId = Guid.NewGuid();
        _erasedUserId = Guid.NewGuid();
        _otherUserId = Guid.NewGuid();
        _plotId = Guid.NewGuid();
        _cycleId = Guid.NewGuid();
        _dailyLogId = Guid.NewGuid();
        _labourAssignmentId = Guid.NewGuid();
        _erasedCorrectionId = Guid.NewGuid();
        _otherCorrectionId = Guid.NewGuid();
        _questionEventId = Guid.NewGuid();
        _richnessId = Guid.NewGuid();
        _termsEventId = Guid.NewGuid();
        _consentEventId = Guid.NewGuid();

        await SeedFixtureAsync();

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _superuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _superuserConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        // Same fake as the sibling suites (defined in ErasureWorkerAnonymizationTest,
        // same assembly + namespace). No voice_clips_retained rows are seeded, so
        // this only satisfies ErasureWorker's IRetainedBlobStore dependency.
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();

        _provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_provider is not null)
        {
            await _provider.DisposeAsync();
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

    /// <summary>
    /// The ownership link goes; the bytes and the co-subject stay. One [Fact]
    /// rather than several because an erasure pass is a single irreversible
    /// event — splitting it would mean running the worker three times over
    /// three scratch databases to assert three halves of one outcome.
    /// </summary>
    [Fact]
    public async Task ErasureWorker_deletes_the_blob_ownership_link_anonymizes_labour_corrections_and_keeps_the_agronomic_record()
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        // ── PRE-STATE. Asserted, not assumed: if the seed silently failed, every
        //    "it is gone" assertion below would pass for the wrong reason. This is
        //    the single most common way an erasure test lies.
        Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.raw_blob_subjects WHERE user_id = @uid", ("uid", _erasedUserId)))!)
            .Should().Be(2, "the erased subject must actually be linked to two blobs before the run");
        Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.labour_corrections WHERE corrected_by_user_id = @uid", ("uid", _erasedUserId)))!)
            .Should().Be(2, "the erased subject must actually own both correction rows before the run");

        await RunOneErasurePassAsync(raw);

        // ── 1. ssf.raw_blob_subjects — DELETE WHERE user_id = X ──────────────
        // This table IS the ownership link. Nothing of it survives for the
        // erased subject.
        Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.raw_blob_subjects WHERE user_id = @uid", ("uid", _erasedUserId)))!)
            .Should().Be(0, "ssf.raw_blob_subjects is the (sha256 -> subject) ownership link and is DELETEd outright");

        // A second subject on the SAME blob is untouched. The table is a
        // many-to-many join precisely so erasing farmer A cannot destroy
        // farmer B's evidence (20260815102440_AddRawBlobSubjects).
        Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.raw_blob_subjects WHERE sha256 = @sha AND user_id = @uid",
            ("sha", SharedBlobSha), ("uid", _otherUserId)))!)
            .Should().Be(1, "a co-subject's linkage on the same blob must survive the other subject's erasure");

        // ── THE DISCLOSED CONSEQUENCE, ASSERTED AS A FACT ────────────────────
        // The bytes are NOT deleted: ssf.raw_blob_index survives, and production
        // holds no s3:DeleteObject permission on either media bucket anyway.
        // Deleting the linkage therefore leaves those bytes unattributable, not
        // gone. This assertion exists so the limitation stays a MEASURED,
        // reviewable property of the system rather than a paragraph someone can
        // quietly stop believing.
        Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.raw_blob_index WHERE sha256 IN (@a, @b)",
            ("a", SharedBlobSha), ("b", OtherBlobSha)))!)
            .Should().Be(2, "the blob rows themselves are NOT deleted by this worker — see the raw_blob_subjects manifest bullet");

        // The audit ledger records the COUNT and never the hashes. Writing the
        // sha256 list beside targetUserId would rebuild the subject-to-blob link
        // inside an append-only table nobody can rewrite.
        Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.audit_events WHERE payload::text LIKE @needle",
            ("needle", "%" + SharedBlobSha + "%")))!)
            .Should().Be(0, "no audit payload may carry the sha256 — that would re-create the link the DELETE just removed");

        Convert.ToInt32((await ScalarAsync(raw,
            """
            SELECT count(*) FROM ssf.audit_events
             WHERE entity_type = 'ErasureAnonymize'
               AND payload::jsonb->>'table' = 'raw_blob_subjects'
               AND (payload::jsonb->>'rowsAnonymized')::int = 2
            """))!)
            .Should().Be(1, "the per-table audit row must state HOW MANY linkage rows were removed");
        // The ::jsonb casts above are load-bearing: ssf.audit_events.payload is
        // mapped as `text` (AuditEventConfiguration), so a bare ->> is 42883.

        // ── 2. ssf.labour_corrections — ANONYMIZE ────────────────────────────
        var correctedBy = (Guid)(await ScalarAsync(raw,
            "SELECT corrected_by_user_id FROM ssf.labour_corrections WHERE \"Id\" = @id", ("id", _erasedCorrectionId)))!;
        correctedBy.Should().Be(SystemActor.ErasedFarmer, "rule (a) — the actor column becomes the sentinel");

        (await ScalarAsync(raw,
            "SELECT reason FROM ssf.labour_corrections WHERE \"Id\" = @id", ("id", _erasedCorrectionId)))
            .Should().BeOfType<DBNull>("rule (b) — the reviewer's free-text reason is NULLed, not left in place");

        // rule (c) — KEEP. The on-field execution reality the founder ruling
        // protects: THAT a correction happened, to which field, on which
        // engagement, when. Without who, and without their words.
        ((Guid)(await ScalarAsync(raw,
            "SELECT farm_id FROM ssf.labour_corrections WHERE \"Id\" = @id", ("id", _erasedCorrectionId)))!)
            .Should().Be(_farmId, "farm_id is a KEEP field");
        ((Guid)(await ScalarAsync(raw,
            "SELECT labour_assignment_id FROM ssf.labour_corrections WHERE \"Id\" = @id", ("id", _erasedCorrectionId)))!)
            .Should().Be(_labourAssignmentId, "labour_assignment_id is a KEEP field");
        ((string)(await ScalarAsync(raw,
            "SELECT changed_field FROM ssf.labour_corrections WHERE \"Id\" = @id", ("id", _erasedCorrectionId)))!)
            .Should().Be(LabourCorrection.FieldWorkerCount, "changed_field is a KEEP field");

        // original_value / new_value survive on a recognised changed_field. They
        // hold a number here, never a name — the CASE guard in
        // AnonymizeLabourCorrectionsAsync exists for a FUTURE free-text field,
        // not for this one.
        ((string)(await ScalarAsync(raw,
            "SELECT original_value FROM ssf.labour_corrections WHERE \"Id\" = @id", ("id", _erasedCorrectionId)))!)
            .Should().Be("8", "a structural value on a recognised changed_field is KEPT");
        ((string)(await ScalarAsync(raw,
            "SELECT new_value FROM ssf.labour_corrections WHERE \"Id\" = @id", ("id", _erasedCorrectionId)))!)
            .Should().Be("6", "a structural value on a recognised changed_field is KEPT");

        // The GUARD, proven live: a row whose changed_field is NOT in
        // LabourCorrection's closed set has its value columns nulled. This is
        // the fail-safe that catches a future correctable field carrying free
        // text, and it is asserted here so it cannot rot into decoration.
        (await ScalarAsync(raw,
            "SELECT original_value FROM ssf.labour_corrections WHERE \"Id\" = @id", ("id", _otherCorrectionId)))
            .Should().BeOfType<DBNull>("an unrecognised changed_field must have its value columns scrubbed BY DEFAULT");

        // Scoping: a correction made by a DIFFERENT reviewer on the SAME farm is
        // untouched — actor, words and all.
        var farmMateCorrectedBy = (Guid)(await ScalarAsync(raw,
            "SELECT corrected_by_user_id FROM ssf.labour_corrections WHERE corrected_by_user_id = @uid",
            ("uid", _otherUserId)))!;
        farmMateCorrectedBy.Should().Be(_otherUserId, "another reviewer's correction must not be scrubbed by this subject's erasure");
        ((string)(await ScalarAsync(raw,
            "SELECT reason FROM ssf.labour_corrections WHERE corrected_by_user_id = @uid", ("uid", _otherUserId)))!)
            .Should().Be(OtherReviewerReason, "another reviewer's words are not this subject's personal data");

        // ── 3. The four KEEPs ────────────────────────────────────────────────
        // "for grapes, a crop, anything that was being practised, I must keep
        // that" — founder, 2026-08-27.
        ((string)(await ScalarAsync(raw,
            "SELECT crop FROM ssf.question_events WHERE \"Id\" = @id", ("id", _questionEventId)))!)
            .Should().Be(KeptCrop, "ssf.question_events KEEPs — which question mattered for which crop at which stage");
        ((string)(await ScalarAsync(raw,
            "SELECT response FROM ssf.question_events WHERE \"Id\" = @id", ("id", _questionEventId)))!)
            .Should().Be(KeptResponse, "the answer is FARM-co-owned agronomic knowledge (D-FREETEXT-PRESERVE-2026-06-29)");

        // Ownership severance is what makes that KEEP honest: the only path back
        // to a person is the parent daily_log, whose operator is now the sentinel.
        ((Guid)(await ScalarAsync(raw,
            "SELECT operator_user_id FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", _dailyLogId)))!)
            .Should().Be(SystemActor.ErasedFarmer, "the KEEP is only de-identified because the parent log's operator was scrubbed");

        Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.daily_richness_aggregates WHERE \"Id\" = @id", ("id", _richnessId)))!)
            .Should().Be(1, "ssf.daily_richness_aggregates is a farm-scoped rollup and KEEPs");

        // The consent ledgers KEEP, and they keep NAMING the erased user. This is
        // the one deliberate exception in the manifest: a consent record that
        // cannot say who consented proves nothing, and these two tables are the
        // only evidence the prior processing was lawful (DPDP §12(3)).
        ((Guid)(await ScalarAsync(raw,
            "SELECT user_id FROM ssf.terms_acceptance_events WHERE \"Id\" = @id", ("id", _termsEventId)))!)
            .Should().Be(_erasedUserId, "terms acceptance KEEPs, and deliberately still names the subject — DPDP §12(3)");
        ((Guid)(await ScalarAsync(raw,
            "SELECT user_id FROM ssf.consent_grant_events WHERE \"Id\" = @id", ("id", _consentEventId)))!)
            .Should().Be(_erasedUserId, "consent grant KEEPs, and deliberately still names the subject — DPDP §12(3)");
    }

    /// <summary>
    /// Runs the worker until the request reaches a terminal status, then
    /// asserts it Completed. Polls rather than sleeping a fixed interval — the
    /// same 2026-07-19 correction the sibling suite carries, for the same
    /// reason: a widening manifest makes any hard-coded budget expire, and the
    /// status it catches on expiry (InProgress) reads like a half-erased user.
    /// </summary>
    private async Task RunOneErasurePassAsync(NpgsqlConnection raw)
    {
        var requestId = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await using var cmd = seed.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.erasure_requests
                    (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
                VALUES (@id, @uid, NULL, 0, NOW());
                """;
            cmd.Parameters.AddWithValue("id", requestId);
            cmd.Parameters.AddWithValue("uid", _erasedUserId);
            await cmd.ExecuteNonQueryAsync();
        }

        var scopeFactory = _provider.GetRequiredService<IServiceScopeFactory>();
        var worker = new ErasureWorker(scopeFactory, NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var workerTask = worker.StartAsync(cts.Token);

        var status = (int)ErasureStatus.Requested;
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (DateTime.UtcNow < deadline)
        {
            status = (int)(await ScalarAsync(raw,
                "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)))!;
            if (status == (int)ErasureStatus.Completed || status == (int)ErasureStatus.Failed)
            {
                break;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(200), CancellationToken.None);
        }

        cts.Cancel();
        try { await workerTask; } catch (OperationCanceledException) { }

        status.Should().Be((int)ErasureStatus.Completed,
            "ErasureWorker must transition the request to Completed within one pass");
    }

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        return await cmd.ExecuteScalarAsync();
    }

    private async Task SeedFixtureAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await ExecAsync(db, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@fid, 'DFES Disposition Proof Farm', @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
            """,
            ("fid", _farmId), ("uid", _erasedUserId));

        await ExecAsync(db, """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
            VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid, CURRENT_DATE, NOW(), 'voice', 'unknown', 'unknown');
            """,
            ("id", _dailyLogId), ("fid", _farmId), ("pid", _plotId), ("cid", _cycleId), ("uid", _erasedUserId));

        await ExecAsync(db, """
            INSERT INTO ssf.labour_assignments
                ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis)
            VALUES (@id, @dlid, 'Hired', 6, 50, NULL, '[]'::jsonb, NOW(), 8, 'Assumed');
            """,
            ("id", _labourAssignmentId), ("dlid", _dailyLogId));

        // The erased reviewer's correction — a RECOGNISED changed_field, so its
        // value columns must survive the scrub.
        await ExecAsync(db, """
            INSERT INTO ssf.labour_corrections
                ("Id", labour_assignment_id, farm_id, changed_field, original_value, new_value, reason, corrected_by_user_id, corrected_at_utc)
            VALUES (@id, @laid, @fid, @field, '8', '6', @reason, @uid, NOW());
            """,
            ("id", _erasedCorrectionId), ("laid", _labourAssignmentId), ("fid", _farmId),
            ("field", LabourCorrection.FieldWorkerCount), ("reason", ReviewerReason), ("uid", _erasedUserId));

        // The erased reviewer's SECOND correction, on a changed_field outside
        // LabourCorrection's closed set. Nothing writes this shape today — it is
        // seeded precisely to exercise the fail-safe branch of the CASE guard,
        // which is the only way to prove that branch is live rather than
        // decorative. The DB has no CHECK constraint on changed_field, so this
        // row is insertable; the closed set is enforced in the domain.
        await ExecAsync(db, """
            INSERT INTO ssf.labour_corrections
                ("Id", labour_assignment_id, farm_id, changed_field, original_value, new_value, reason, corrected_by_user_id, corrected_at_utc)
            VALUES (@id, @laid, @fid, 'SomeFutureFreeTextField', 'Ramesh Pawar', 'Ganesh Pawar', @reason, @uid, NOW());
            """,
            ("id", _otherCorrectionId), ("laid", _labourAssignmentId), ("fid", _farmId),
            ("reason", ReviewerReason), ("uid", _erasedUserId));

        // A DIFFERENT reviewer on the SAME farm — must come through untouched.
        await ExecAsync(db, """
            INSERT INTO ssf.labour_corrections
                ("Id", labour_assignment_id, farm_id, changed_field, original_value, new_value, reason, corrected_by_user_id, corrected_at_utc)
            VALUES (@id, @laid, @fid, @field, '4', '5', @reason, @uid, NOW());
            """,
            ("id", Guid.NewGuid()), ("laid", _labourAssignmentId), ("fid", _farmId),
            ("field", LabourCorrection.FieldMaleCount), ("reason", OtherReviewerReason), ("uid", _otherUserId));

        // Two blobs. One is shared with a second subject, which is the whole
        // reason raw_blob_subjects is a join table and not a column.
        foreach (var sha in new[] { SharedBlobSha, OtherBlobSha })
        {
            await ExecAsync(db, """
                INSERT INTO ssf.raw_blob_index (sha256, s3_key, content_type, size_bytes, first_seen_utc, ref_count)
                VALUES (@sha, @key, 'audio/webm', 1024, NOW(), 1);
                """,
                ("sha", sha), ("key", $"raw/{sha}"));
        }

        await ExecAsync(db, """
            INSERT INTO ssf.raw_blob_subjects (sha256, user_id, first_seen_utc) VALUES
                (@shared, @erased, NOW()),
                (@other,  @erased, NOW()),
                (@shared, @co,     NOW());
            """,
            ("shared", SharedBlobSha), ("other", OtherBlobSha), ("erased", _erasedUserId), ("co", _otherUserId));

        // ── The KEEPs ───────────────────────────────────────────────────────
        await ExecAsync(db, """
            INSERT INTO ssf.question_events
                ("Id", daily_log_id, farm_id, plot_id, question_key, crop, expected_stage, anchor_date_type,
                 trigger_type, question_type, lens, depth_level, priority, cooldown, answer_modes, safety_class,
                 agronomist_approved, marathi_approved, bank_version, question_engine_version, response, created_at_utc)
            VALUES (@id, @dlid, @fid, @pid, 'grapes.berryset.sulphur', @crop, 'BerrySet', 'Pruning',
                    'StageEntry', 'Practice', 'Execution', 1, 1, 7, 'Voice', 'Safe',
                    true, true, 'v1', 'v1', @response, NOW());
            """,
            ("id", _questionEventId), ("dlid", _dailyLogId), ("fid", _farmId), ("pid", _plotId),
            ("crop", KeptCrop), ("response", KeptResponse));

        await ExecAsync(db, """
            INSERT INTO ssf.daily_richness_aggregates
                ("Id", farm_id, local_date, time_zone, day_classification, has_work, has_meaningful_observation,
                 has_learning, has_experiment_outcome, has_disturbance, has_declared_no_work_reason,
                 advances_streak, advances_bar, shram_points_earned, reward_reasons, score_engine_version,
                 components_json, created_at_utc, updated_at_utc)
            VALUES (@id, @fid, CURRENT_DATE, 'Asia/Kolkata', 'WorkDay', true, true,
                    false, false, false, false, true, true, 10, '[]'::jsonb, 'v1',
                    '{}'::jsonb, NOW(), NOW());
            """,
            ("id", _richnessId), ("fid", _farmId));

        await ExecAsync(db, """
            INSERT INTO ssf.terms_acceptance_events
                ("Id", event_type, user_id, pre_registration_session_id, notice_version, privacy_policy_version,
                 terms_version, displayed_language, accepted_purpose_codes, data_category_codes, source,
                 app_version, notice_hash, status, recorded_at_utc)
            VALUES (@id, 'TermsAccepted', @uid, 'sess-dfes-proof', 'n1', 'p1', 't1', 'mr-IN',
                    'core', 'voice', 'app', '1.0.0', 'sha256:notice', 'Granted', NOW());
            """,
            ("id", _termsEventId), ("uid", _erasedUserId));

        await ExecAsync(db, """
            INSERT INTO ssf.consent_grant_events
                ("Id", event_type, user_id, pre_registration_session_id, notice_version, privacy_policy_version,
                 terms_version, displayed_language, accepted_purpose_codes, data_category_codes, source,
                 app_version, notice_hash, status, recorded_at_utc)
            VALUES (@id, 'ConsentGranted', @uid, 'sess-dfes-proof', 'n1', 'p1', 't1', 'mr-IN',
                    'core', 'voice', 'app', '1.0.0', 'sha256:notice', 'Granted', NOW());
            """,
            ("id", _consentEventId), ("uid", _erasedUserId));
    }

    private static async Task ExecAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        await cmd.ExecuteNonQueryAsync();
    }
}
