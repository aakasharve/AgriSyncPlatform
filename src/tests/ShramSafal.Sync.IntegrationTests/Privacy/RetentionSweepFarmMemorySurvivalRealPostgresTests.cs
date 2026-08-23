// spec: dfes-companion-2026-07-11 (farm-memory)
//
// Replaces RetentionSweepWorkerVoiceClipsRetainedTest, whose central
// assertion was "UserA has withdrawn consent; all 3 retained clips MUST
// be swept". That expectation is now the defect, not the contract: the
// founder's 2026-08-23 decision set and ADR-DS-017 make original voice
// Farm Memory, which ends when the farmer decides it ends and not when a
// calendar or a settings toggle decides for him. Keeping the old test
// would have pinned the behaviour this branch exists to remove.
//
// The old file's other job — ADR-DS-009 §(b) consent-token-kid
// provenance on retained voice — is not lost with it. That proof lives
// in PersistVoiceClipRetainedHandlerKidStampTest, on the persist side,
// and is untouched. §(c) per-recording sweep auditability had exactly
// one subject, the sweep's per-clip deletion; with no such deletion left
// there is no lifecycle event to audit, and this test asserts the
// absence directly rather than leaving it to inference.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Jobs;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// <b>Farm Memory survives the nightly sweep; technical data does not.</b>
///
/// <para><b>The two failures this pins shut.</b> The retention sweep used
/// to delete a farmer's retained voice on either of two triggers, and
/// both of them are things the farmer never asked for:</para>
/// <list type="number">
///   <item><description><b>A calendar.</b> A clip older than 1825 days was
///   swept. ADR-DS-017 (b) removes that — Farm Memory is not silently
///   deleted because five years elapsed.</description></item>
///   <item><description><b>A settings toggle.</b> Any clip whose owner had
///   <c>FullHistoryJournal=false</c> with a withdrawal stamp was swept, so
///   the farmer who said "stop recording me" lost everything he had ever
///   kept, within 24 hours. ADR-DS-017 (c): stopping future retention and
///   deleting past retention are two intentions, and performing the second
///   on being asked for the first is the sharper of the two bugs because
///   it fires immediately rather than in five years.</description></item>
/// </list>
///
/// <para><b>Why the farmer here is in the worst position both triggers
/// could put him in.</b> He has switched future saving OFF <i>and</i> owns
/// a clip well past the retired horizon. Under the old code every clip he
/// had would be gone by morning — twice over, and by two independent
/// routes. He keeps all of it.</para>
///
/// <para><b>"Present and retrievable", not "the row is still there".</b>
/// A retained clip is two things in two stores: a metadata row and the
/// ciphertext it points at. A test counting rows passes cleanly while the
/// audio is gone and the farmer taps play on silence. So the blob store
/// here is a faithful double of <c>S3RetainedBlobStore</c> — objects live
/// in a map SEPARATE from the rows, and <c>GetByIdAsync</c> returns null
/// if either half is missing, exactly as the real adapter 404s. Survival
/// is asserted by reading the bytes back and comparing them.</para>
///
/// <para><b>Both clips are proven readable BEFORE the sweep runs.</b> An
/// assertion that something did not disappear is worthless unless the test
/// can first show it was there.</para>
///
/// <para><b>The technical timers are asserted in the same pass.</b>
/// Removing the horizon for Farm Memory must not quietly disarm the sweep
/// for founder ITEM 5 category B data. Aged <c>ssf.export_artifacts</c>
/// (7 days) and <c>ssf.audit_read_telemetry</c> (30 days) rows are seeded
/// alongside fresh ones and must still be deleted — otherwise this file
/// would happily pass against a worker that had simply stopped
/// running.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Creates its own
/// scratch database, applies the full migration chain, drops it on
/// dispose. A genuinely absent server SKIPS and says so loudly; a server
/// that answers and refuses THROWS, because a skipped proof is not a
/// passing one.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class RetentionSweepFarmMemorySurvivalRealPostgresTests(ITestOutputHelper output)
    : IAsyncLifetime
{
    /// <summary>
    /// The horizon that used to govern, kept as a literal so the fixture can
    /// place a clip unambiguously beyond it. Nothing in production reads a
    /// horizon any more; this constant exists so the test can prove that.
    /// </summary>
    private const int RetiredHorizonDays = 1825;

    private static readonly Guid FarmerUserId = Guid.Parse("17bb0000-0000-0000-0000-000000000001");
    private static readonly Guid NoConsentRowUserId = Guid.Parse("17bb0000-0000-0000-0000-000000000002");
    private static readonly Guid AgedClipId = Guid.Parse("17bb0000-0000-0000-0000-0000000000a1");
    private static readonly Guid RecentClipId = Guid.Parse("17bb0000-0000-0000-0000-0000000000b1");
    private static readonly Guid OrphanOwnerClipId = Guid.Parse("17bb0000-0000-0000-0000-0000000000c1");
    private const string FarmerKid = "kid-2026-08-23-farm-memory";

    /// <summary>Distinct payloads, so no survivor can be "proven" by an empty array.</summary>
    private static readonly byte[] AgedCipher = { 0xA1, 0xA2, 0xA3, 0xA4 };
    private static readonly byte[] RecentCipher = { 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6 };
    private static readonly byte[] OrphanOwnerCipher = { 0xC1, 0xC2, 0xC3 };

    private static readonly Guid AgedExportArtifactId = Guid.Parse("17bb0000-0000-0000-0000-0000000000e1");
    private static readonly Guid FreshExportArtifactId = Guid.Parse("17bb0000-0000-0000-0000-0000000000e2");
    private static readonly Guid AgedTelemetryId = Guid.Parse("17bb0000-0000-0000-0000-0000000000f1");
    private static readonly Guid FreshTelemetryId = Guid.Parse("17bb0000-0000-0000-0000-0000000000f2");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _rootProvider;
    private FaithfulRetainedBlobStore _blobStore = default!;

    public async Task InitializeAsync()
    {
        var baseConn = IntegrationPostgres.ResolveRootConnection();

        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        _adminConn = baseConn;
        _scratchDbName = $"ssf_farm_memory_{Guid.NewGuid():N}";
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
            Username = IntegrationPostgres.AppRoleUser,
            Password = IntegrationPostgres.AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await SeedConsentAndTechnicalDataAsync();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
                // The sweep runs cross-tenant under the migration role, as
                // every hosted service in this codebase does.
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
                // Deliberately set, and deliberately expected to do nothing.
                // If someone reintroduces a horizon this key is the switch
                // they would reach for, and a one-day window would destroy
                // every clip in this fixture. Assert 4 catches that.
                ["Privacy:VoiceClipsRetained:MaxAgeDays"] = "1",
            }!)
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);

        // Registered AFTER the infrastructure so this double wins over the
        // real S3 adapter.
        _blobStore = new FaithfulRetainedBlobStore(_superuserConn);
        services.AddSingleton<IRetainedBlobStore>(_blobStore);

        _rootProvider = services.BuildServiceProvider();
    }

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

    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE PROOF
    // ─────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Sweep_keeps_every_retained_clip_of_a_farmer_who_turned_future_saving_off_and_still_expires_technical_data()
    {
        SkipIfPostgresUnavailable();

        var ct = CancellationToken.None;
        var nowUtc = DateTime.UtcNow;

        // ── Arrange. One farmer with future saving switched OFF, holding a
        //    clip six years old and one from three days ago. Plus a second
        //    user with NO user_consent_state row at all — the old candidate
        //    query treated a missing row as "no grant" and let the age
        //    branch govern, so his clip died too.
        await PersistClipAsync(FarmerUserId, AgedClipId, nowUtc.AddDays(-(RetiredHorizonDays + 400)), AgedCipher, ct);
        await PersistClipAsync(FarmerUserId, RecentClipId, nowUtc.AddDays(-3), RecentCipher, ct);
        await PersistClipAsync(NoConsentRowUserId, OrphanOwnerClipId, nowUtc.AddDays(-900), OrphanOwnerCipher, ct);

        // ── Prove all three are readable before asserting that they survive.
        await AssertReadableAsync(FarmerUserId, AgedClipId, AgedCipher, "aged clip", ct);
        await AssertReadableAsync(FarmerUserId, RecentClipId, RecentCipher, "recent clip", ct);
        await AssertReadableAsync(NoConsentRowUserId, OrphanOwnerClipId, OrphanOwnerCipher, "no-consent-row clip", ct);
        output.WriteLine("[BEFORE] all three clips readable from the blob store, byte-for-byte.");

        // ── Act. One nightly pass.
        await RunOneSweepPassAsync();

        // ── Assert 1. THE INVARIANT. Every clip is still present AND still
        //    retrievable — audio included, not just a surviving row.
        await AssertReadableAsync(FarmerUserId, AgedClipId, AgedCipher,
            "a clip past the retired 1825-day horizon — Farm Memory has no calendar expiry (ADR-DS-017 (b))", ct);
        await AssertReadableAsync(FarmerUserId, RecentClipId, RecentCipher,
            "a clip whose owner switched future saving off — that is 'stop saving', not 'delete what I saved' (ADR-DS-017 (c))", ct);
        await AssertReadableAsync(NoConsentRowUserId, OrphanOwnerClipId, OrphanOwnerCipher,
            "a clip whose owner has no consent row at all — a missing row is not a farmer asking for deletion", ct);

        (await ScalarIntAsync("SELECT count(*) FROM ssf.voice_clips_retained")).Should().Be(3,
            "not one retained clip may be removed by a scheduled job");

        // ── Assert 2. The structural guard. The sweep must never reach for
        //    the delete-everything-this-user-owns path; that shape belongs to
        //    DPDP §12 erasure and account closure, where the farmer really
        //    did mean all of it.
        _blobStore.PerUserDeleteCalls.Should().BeEmpty(
            "the retention sweep must not call DeleteRetainedVoiceForUserAsync — routing any decision it makes " +
            "through a per-user delete is how one clip took a farmer's whole diary with it");

        // ── Assert 3. No sweep-deletion audit rows, because no sweep
        //    deletion happened. ADR-DS-009 §(c) required one audit row per
        //    swept clip; zero swept clips must mean zero rows, not a
        //    fabricated trail.
        (await ScalarIntAsync(
            "SELECT count(*) FROM ssf.audit_events " +
            "WHERE entity_type = 'VoiceClipRetained' AND action = 'RetentionSweep'"))
            .Should().Be(0, "nothing was swept, so nothing may be audited as swept");

        // ── Assert 4. The sweep's own record must not name the table. A run
        //    row claiming voice_clips_retained was swept is a false statement
        //    about the farmer's data even when no row was touched (P4).
        var tablesSwept = await ScalarStringAsync(
            "SELECT tables_swept FROM ssf.retention_sweep_runs ORDER BY occurred_at_utc DESC LIMIT 1");
        tablesSwept.Should().NotBeNullOrEmpty();
        tablesSwept.Should().NotContain("voice_clips_retained",
            "the worker no longer sweeps Farm Memory and must not report that it did");

        // ── Assert 5. Category B still expires. Removing the horizon for
        //    Farm Memory must not disarm the technical timers — and this
        //    assertion is also what stops the whole file passing against a
        //    worker that simply never ran.
        (await RowExistsAsync("ssf.export_artifacts", "id", AgedExportArtifactId)).Should().BeFalse(
            "an export ZIP older than 7 days is founder ITEM 5 category B — generated, disposable, still swept");
        (await RowExistsAsync("ssf.export_artifacts", "id", FreshExportArtifactId)).Should().BeTrue(
            "a two-day-old export artifact is inside its window and must survive");
        (await RowExistsAsync("ssf.audit_read_telemetry", "id", AgedTelemetryId)).Should().BeFalse(
            "read telemetry older than 30 days is category B and still swept");
        (await RowExistsAsync("ssf.audit_read_telemetry", "id", FreshTelemetryId)).Should().BeTrue(
            "five-day-old read telemetry is inside its window and must survive");

        tablesSwept.Should().Contain("export_artifacts").And.Contain("audit_read_telemetry",
            "the two technical surfaces are still this worker's job");

        output.WriteLine("[AFTER] all three clips still readable; aged export artifact + aged telemetry deleted.");
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task AssertReadableAsync(Guid userId, Guid clipId, byte[] expected, string because, CancellationToken ct)
    {
        var clip = await _blobStore.GetByIdAsync(clipId, userId, ct);
        clip.Should().NotBeNull($"{because} — the clip must be retrievable, not merely have a row");
        clip!.CipherBytes.Should().Equal(expected,
            $"{because} — the audio must come back byte-identical; truncated or empty is a lost recording");
    }

    private async Task PersistClipAsync(Guid userId, Guid clipId, DateTime recordedAtUtc, byte[] cipher, CancellationToken ct)
    {
        var metadata = VoiceClipRetained.Create(
            clipId: clipId,
            userId: userId,
            recordedAtUtc: DateTime.SpecifyKind(recordedAtUtc, DateTimeKind.Utc),
            s3Key: VoiceClipRetained.BuildS3Key(userId, clipId),
            dekId: "dek-farm-memory",
            ivBase64: "AAAAAAAAAAAAAAAA",
            authTagBase64: "BBBBBBBBBBBBBBBB",
            durationSeconds: 5,
            language: "mr-IN",
            consentAuditId: null,
            nowUtc: DateTime.UtcNow);

        await _blobStore.PersistAsync(metadata, cipher, ct);
    }

    private async Task SeedConsentAndTechnicalDataAsync()
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        // The farmer turned FullHistoryJournal OFF two hours ago. This is
        // the exact state the old predicate keyed on.
        await using (var c = raw.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.user_consent_state
                    (user_id, full_history_journal, cross_farm_aggregation, research_corpus_export,
                     version, granted_at_utc, withdrawn_at_utc, current_token_kid)
                VALUES (@uid, false, false, false, 1, NOW() - INTERVAL '400 days', NOW() - INTERVAL '2 hours', @kid);
                """;
            c.Parameters.AddWithValue("uid", FarmerUserId);
            c.Parameters.AddWithValue("kid", FarmerKid);
            await c.ExecuteNonQueryAsync();
        }

        // NoConsentRowUserId deliberately gets NO row.

        await using (var c = raw.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.export_artifacts (id, user_id, s3_key, created_at_utc, presigned_url_expires_at_utc)
                VALUES (@aged, @uid, @agedKey, NOW() - INTERVAL '30 days', NULL),
                       (@fresh, @uid, @freshKey, NOW() - INTERVAL '2 days', NULL);
                """;
            c.Parameters.AddWithValue("aged", AgedExportArtifactId);
            c.Parameters.AddWithValue("fresh", FreshExportArtifactId);
            c.Parameters.AddWithValue("uid", FarmerUserId);
            c.Parameters.AddWithValue("agedKey", $"exports/{FarmerUserId:D}/aged.zip");
            c.Parameters.AddWithValue("freshKey", $"exports/{FarmerUserId:D}/fresh.zip");
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = raw.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.audit_read_telemetry (id, actor_user_id, entity_type, entity_id, read_at_utc)
                VALUES (@aged, @uid, 'DailyLog', @aged, NOW() - INTERVAL '60 days'),
                       (@fresh, @uid, 'DailyLog', @fresh, NOW() - INTERVAL '5 days');
                """;
            c.Parameters.AddWithValue("aged", AgedTelemetryId);
            c.Parameters.AddWithValue("fresh", FreshTelemetryId);
            c.Parameters.AddWithValue("uid", FarmerUserId);
            await c.ExecuteNonQueryAsync();
        }
    }

    /// <summary>
    /// Fires one <see cref="RetentionSweepWorker"/> pass and waits for the
    /// pass to record itself, rather than sleeping a fixed interval and
    /// hoping.
    /// </summary>
    private async Task RunOneSweepPassAsync()
    {
        var scopeFactory = _rootProvider!.GetRequiredService<IServiceScopeFactory>();
        var worker = new RetentionSweepWorker(scopeFactory, NullLogger<RetentionSweepWorker>.Instance);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var workerTask = worker.StartAsync(cts.Token);

        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (DateTime.UtcNow < deadline)
        {
            if (await ScalarIntAsync("SELECT count(*) FROM ssf.retention_sweep_runs") > 0)
            {
                break;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(250), CancellationToken.None);
        }

        cts.Cancel();
        try { await workerTask; } catch (OperationCanceledException) { }

        (await ScalarIntAsync("SELECT count(*) FROM ssf.retention_sweep_runs")).Should().BeGreaterThan(0,
            "the worker must actually have completed a pass — asserting about a sweep that never ran proves nothing");
    }

    private async Task<bool> RowExistsAsync(string table, string idColumn, Guid id)
        => await ScalarIntAsync($"SELECT count(*) FROM {table} WHERE {idColumn} = '{id}'") > 0;

    private async Task<int> ScalarIntAsync(string sql)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<string?> ScalarStringAsync(string sql)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var raw = await cmd.ExecuteScalarAsync();
        return raw is null or DBNull ? null : raw.ToString();
    }
}

/// <summary>
/// A faithful double of
/// <see cref="ShramSafal.Infrastructure.Privacy.S3RetainedBlobStore"/>.
///
/// <para>Faithful in the one way that matters here: the audio objects live
/// in a map SEPARATE from the metadata rows, and every method observes the
/// same split the real adapter does. <c>PersistAsync</c> writes both.
/// <c>DeleteRetainedVoiceForUserAsync</c> enumerates every row the user
/// owns and destroys both halves for all of them — that really is the real
/// adapter's contract, which is why the sweep calling it was catastrophic,
/// and why this test asserts the sweep never calls it.
/// <c>GetByIdAsync</c> returns null when either half is missing, mirroring
/// the real adapter's 404 handling.</para>
///
/// <para>Because the object map is real state rather than a call log,
/// "the clip is retrievable" is a genuine read and not a row count wearing
/// a costume.</para>
/// </summary>
internal sealed class FaithfulRetainedBlobStore : IRetainedBlobStore
{
    private readonly string _conn;
    private readonly Dictionary<Guid, byte[]> _objects = new();

    public FaithfulRetainedBlobStore(string conn) => _conn = conn;

    /// <summary>Every user id handed to the whole-user delete path.</summary>
    public List<Guid> PerUserDeleteCalls { get; } = new();

    public async Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(
        Guid userId, CancellationToken ct)
    {
        PerUserDeleteCalls.Add(userId);

        var clipIds = await ClipIdsForUserAsync(userId, ct).ConfigureAwait(false);
        foreach (var clipId in clipIds)
        {
            _objects.Remove(clipId);
        }

        await using var db = new NpgsqlConnection(_conn);
        await db.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "DELETE FROM ssf.voice_clips_retained WHERE user_id = @uid";
        cmd.Parameters.AddWithValue("uid", userId);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);

        return clipIds.Count == 0
            ? RetainedVoiceDeletionOutcome.Nothing
            : RetainedVoiceDeletionOutcome.Removed(clipIds.Count);
    }

    public async Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        ArgumentNullException.ThrowIfNull(cipherBytes);

        await using var db = new NpgsqlConnection(_conn);
        await db.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.voice_clips_retained
                (clip_id, user_id, recorded_at_utc, s3_key, dek_id, iv_b64, auth_tag_b64,
                 duration_seconds, language, consent_audit_id, created_at_utc)
            VALUES (@cid, @uid, @rec, @s3key, @dek, @iv, @tag, @dur, @lang, NULL, @created)
            ON CONFLICT (clip_id) DO NOTHING;
            """;
        cmd.Parameters.AddWithValue("cid", metadata.ClipId);
        cmd.Parameters.AddWithValue("uid", metadata.UserId);
        cmd.Parameters.AddWithValue("rec", metadata.RecordedAtUtc);
        cmd.Parameters.AddWithValue("s3key", metadata.S3Key);
        cmd.Parameters.AddWithValue("dek", metadata.DekId);
        cmd.Parameters.AddWithValue("iv", metadata.IvBase64);
        cmd.Parameters.AddWithValue("tag", metadata.AuthTagBase64);
        cmd.Parameters.AddWithValue("dur", metadata.DurationSeconds);
        cmd.Parameters.AddWithValue("lang", metadata.Language);
        cmd.Parameters.AddWithValue("created", metadata.CreatedAtUtc);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);

        _objects[metadata.ClipId] = cipherBytes;
        return metadata.ClipId;
    }

    public async Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct)
    {
        await using var db = new NpgsqlConnection(_conn);
        await db.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT recorded_at_utc, s3_key, dek_id, iv_b64, auth_tag_b64, duration_seconds, language
            FROM ssf.voice_clips_retained
            WHERE clip_id = @cid AND user_id = @uid;
            """;
        cmd.Parameters.AddWithValue("cid", clipId);
        cmd.Parameters.AddWithValue("uid", callerUserId);

        await using var rdr = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await rdr.ReadAsync(ct).ConfigureAwait(false))
        {
            return null;
        }

        var recordedAtUtc = rdr.GetDateTime(0);
        var s3Key = rdr.GetString(1);
        var dekId = rdr.GetString(2);
        var iv = rdr.GetString(3);
        var tag = rdr.GetString(4);
        var duration = rdr.GetInt32(5);
        var language = rdr.GetString(6);

        // The real adapter 404s here when the object is gone and returns null
        // rather than a row with no audio. Same rule, so a destroyed object
        // can never be mistaken for a retrievable clip.
        if (!_objects.TryGetValue(clipId, out var cipher))
        {
            return null;
        }

        return new RetainedClipResult(
            ClipId: clipId,
            UserId: callerUserId,
            RecordedAtUtc: recordedAtUtc,
            S3Key: s3Key,
            DekId: dekId,
            IvBase64: iv,
            AuthTagBase64: tag,
            DurationSeconds: duration,
            Language: language,
            CipherBytes: cipher);
    }

    public async Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
        Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var fromUtc = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var toUtc = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        var items = new List<VoiceClipRetainedListItem>();
        await using var db = new NpgsqlConnection(_conn);
        await db.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT clip_id, recorded_at_utc, duration_seconds, language, s3_key
            FROM ssf.voice_clips_retained
            WHERE user_id = @uid AND recorded_at_utc >= @from AND recorded_at_utc < @to
            ORDER BY recorded_at_utc DESC;
            """;
        cmd.Parameters.AddWithValue("uid", userId);
        cmd.Parameters.AddWithValue("from", fromUtc);
        cmd.Parameters.AddWithValue("to", toUtc);

        await using var rdr = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await rdr.ReadAsync(ct).ConfigureAwait(false))
        {
            items.Add(new VoiceClipRetainedListItem(
                rdr.GetGuid(0),
                rdr.GetDateTime(1),
                rdr.GetInt32(2),
                rdr.GetString(3),
                rdr.GetString(4)));
        }

        return items;
    }

    private async Task<List<Guid>> ClipIdsForUserAsync(Guid userId, CancellationToken ct)
    {
        var ids = new List<Guid>();
        await using var db = new NpgsqlConnection(_conn);
        await db.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT clip_id FROM ssf.voice_clips_retained WHERE user_id = @uid";
        cmd.Parameters.AddWithValue("uid", userId);
        await using var rdr = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await rdr.ReadAsync(ct).ConfigureAwait(false))
        {
            ids.Add(rdr.GetGuid(0));
        }
        return ids;
    }
}
