// spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — founder D-44 / D-46 / D-31
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Amazon.S3;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Application.UseCases.Logs.GetLogOriginalVoice;
using ShramSafal.Application.UseCases.Memberships.GetLabourPermissions;
using ShramSafal.Application.UseCases.Memberships.ManageMembership;
using ShramSafal.Application.UseCases.Memberships.SetLabourPermission;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryById;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// <b>PLR-D10 I27 — owner confirmation and voice evidence</b>, proved on real Postgres as the
/// non-superuser <c>agrisync_app</c> role (doctrine E3), through the real <c>/sync/push</c> and
/// replay handlers.
///
/// <para><b>Who may confirm (founder D-44 / D-46, and 2026-08-27).</b> Only the primary owner, or a
/// member holding the owner's grant (his own record too, by the 2026-08-27 ruling), reaches Verified;
/// the confirmation stores the record version it covered and whether the confirmer heard or read.
/// The I13 result screen's "पक्कं आहे" (verify_log_v2 with no review basis, from the record's own
/// speaker) and a co-owner's tap are accepted and kept as marks — never Verified, never on the wire,
/// never refused. A member without the grant, and a person of another farm, are refused. A stale
/// version is refused with a three-segment <c>.Conflict</c>.</para>
///
/// <para><b>Who may replay (founder D-31).</b> The speaker, the primary owner or a granted member
/// of THAT farm; only while the speaker's "keep original voice" is ON under the current words; only
/// the speaker's own clip that the record links to. A member without the grant and a person of
/// another farm are refused; a pre-L5 ON (no words version) does not count.</para>
///
/// <para>Each fact builds its OWN scratch database (full migration chain) on the cluster named by
/// <c>REQUIRES_POSTGRES_ROOT_CONN</c> and drops it on dispose. Fail-loud: no reachable Postgres is
/// a FAILURE, never a skip.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class OwnerConfirmationAndVoiceReplayRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;
    private const string CurrentVoiceWords = "voice-keep-2026-11-06.1";
    private const string PreRenameVoiceWords = "voice-keep-2026-10-30.1";

    private static readonly Guid FarmA = Guid.Parse("27270000-0000-0000-0000-00000000000a");
    private static readonly Guid AccountA = Guid.Parse("27270000-0000-0000-0000-0000000000aa");
    private static readonly Guid FarmB = Guid.Parse("27270000-0000-0000-0000-00000000000b");
    private static readonly Guid AccountB = Guid.Parse("27270000-0000-0000-0000-0000000000bb");
    private static readonly Guid Owner = Guid.Parse("27270000-0000-0000-0000-000000000001");
    private static readonly Guid Worker = Guid.Parse("27270000-0000-0000-0000-000000000002");
    private static readonly Guid Mukadam = Guid.Parse("27270000-0000-0000-0000-000000000003");
    private static readonly Guid CoOwner = Guid.Parse("27270000-0000-0000-0000-000000000004");
    private static readonly Guid UngrantedWorker = Guid.Parse("27270000-0000-0000-0000-000000000005");
    private static readonly Guid OtherFarmOwner = Guid.Parse("27270000-0000-0000-0000-000000000006");
    private static readonly Guid PlotA = Guid.Parse("27270000-0000-0000-0000-0000000000c1");
    private static readonly Guid CycleA = Guid.Parse("27270000-0000-0000-0000-0000000000c2");

    private static readonly byte[] SealedBytes = [7, 7, 7, 7];

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_i27_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn) { Username = AppRoleUser, Password = AppRolePassword }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
                """);
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farmA, 'I27 Farm A', @owner, @accountA, NOW(), NOW(), 3.0, 'Unchecked'),
                       (@farmB, 'I27 Farm B', @otherOwner, @accountB, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plot, @farmA, 'Plot A', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycle, @farmA, @plot, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                """,
                ("farmA", FarmA), ("farmB", FarmB), ("owner", Owner), ("otherOwner", OtherFarmOwner),
                ("accountA", AccountA), ("accountB", AccountB), ("plot", PlotA), ("cycle", CycleA));
            foreach (var (farm, account, user, role) in new[]
            {
                (FarmA, AccountA, Owner, "PrimaryOwner"),
                (FarmA, AccountA, Worker, "Worker"),
                (FarmA, AccountA, Mukadam, "Mukadam"),
                (FarmA, AccountA, CoOwner, "SecondaryOwner"),
                (FarmA, AccountA, UngrantedWorker, "Worker"),
                (FarmB, AccountB, OtherFarmOwner, "PrimaryOwner"),
            })
            {
                await ExecAsync(raw, """
                    INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                    VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3);
                    """,
                    ("id", Guid.NewGuid()), ("farm", farm), ("user", user), ("role", role), ("account", account));
            }

            // The owner's switch (जबाबदारी) for the मुकादम only — the existing stored grant.
            await ExecAsync(raw,
                "UPDATE ssf.farm_memberships SET can_manage_labour_records = true WHERE farm_id = @farm AND user_id = @user",
                ("farm", FarmA), ("user", Mukadam));

            // lane 2b (P11) — the seats as they stand on an UPGRADED farm: the मुकादम's switch is
            // हजेरी + confirm records; the सहमालक keeps हजेरी (no confirming: he had no switch).
            await UpgradedSeats.CarryAsync(raw, FarmA);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();
        // The archive exactly as production reads it (S3RetainedBlobStore's own DB query, as the
        // app role); only the S3 bytes are stood in for, because there is no bucket here.
        services.AddScoped<IRetainedBlobStore>(sp => new BytesFromS3StandIn(new S3RetainedBlobStore(
            new AmazonS3Client("no-access-key", "no-secret-key", new AmazonS3Config { ServiceURL = "http://127.0.0.1:9" }),
            Options.Create(new RetainedBlobStoreOptions()),
            sp.GetRequiredService<ShramSafalDbContext>())));

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
            await ExecAsync(admin,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()",
                ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. WHO MAY CONFIRM
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Only_the_primary_owner_or_a_grant_holder_confirms_and_the_confirmation_records_version_and_basis()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var clip = Guid.NewGuid();
        var logId = Guid.NewGuid();

        // The worker speaks: auto-saved, linked to its recording, version 1.
        await PushAppliedAsync(Worker, "create_daily_log", "i27-create", CreatePayload(logId, Worker, clip));
        (await ScalarOnSuperuserAsync("SELECT voice_clip_id FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId)))
            .Should().Be(clip, "the clip-log link is stored with the record");
        (await ContentVersionAsync(logId)).Should().Be(1);

        // (a) A plain worker (no grant) was never let through the approve gate — no phone ever offered him
        // a confirm — and still is not: refused exactly as before (P11), nothing written.
        var workerTap = await PushResultAsync(Worker, "verify_log_v2", "i27-speaker", VerifyPayload(logId, Worker));
        output.WriteLine($"[EVIDENCE] plain worker's own tap -> {workerTap.Status} {workerTap.ErrorCode}");
        workerTap.Status.Should().Be("failed");
        workerTap.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await ReadEventsAsync(logId)).Select(e => e.Status).Should().Equal("Draft");
        (await PullDailyLogAsync(Worker, logId)).LastVerificationStatus.Should().Be("Draft");

        // (b) A member WITHOUT the owner's grant is refused (unchanged), and so is another farm's owner.
        (await PushResultAsync(UngrantedWorker, "verify_log_v2", "i27-ungranted", VerifyPayload(logId, UngrantedWorker)))
            .Status.Should().Be("failed");
        var foreign = await PushResultAsync(OtherFarmOwner, "verify_log_v2", "i27-foreign", VerifyPayload(logId, OtherFarmOwner));
        output.WriteLine($"[EVIDENCE] other farm's owner -> {foreign.Status} {foreign.ErrorCode}");
        foreign.Status.Should().Be("failed");

        // (c) A co-owner's role alone does not confirm: accepted, kept as a mark.
        await PushAppliedAsync(CoOwner, "verify_log_v2", "i27-coowner", VerifyPayload(logId, CoOwner, "heard"));
        (await ReadEventsAsync(logId))[^1].Reason.Should().Be("mark-without-confirm-authority");
        (await ReadEventsAsync(logId)).Should().NotContain(e => e.Status == "Verified");

        // (d) A correction moves the version on; a confirm naming the old version is refused.
        await PushAppliedAsync(Owner, "add_log_task", "i27-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["activityType"] = "irrigation",
        });
        (await ContentVersionAsync(logId)).Should().Be(2);
        var stale = await PushResultAsync(Owner, "verify_log_v2", "i27-stale", VerifyPayload(logId, Owner, "read", logVersion: 1));
        output.WriteLine($"[EVIDENCE] stale version -> {stale.Status} {stale.ErrorCode}");
        stale.Status.Should().Be("failed");
        stale.ErrorCode.Should().Be("ShramSafal.LogVersion.Conflict");
        (await ReadEventsAsync(logId)).Should().NotContain(e => e.Status == "Verified");

        // (e) The मुकादम holding the owner's grant confirms the worker's record, by reading it.
        await PushAppliedAsync(Mukadam, "verify_log_v2", "i27-granted", VerifyPayload(logId, Mukadam, "read", logVersion: 2));
        var confirmed = await ReadEventsAsync(logId);
        output.WriteLine($"[EVIDENCE] granted मुकादम: {Describe(confirmed)}");
        var verified = confirmed.Single(e => e.Status == "Verified");
        verified.By.Should().Be(Mukadam);
        verified.Version.Should().Be(2);
        verified.Basis.Should().Be("read");
        var onWire = await PullDailyLogAsync(Owner, logId);
        onWire.LastVerificationStatus.Should().Be("Verified");
        onWire.VerificationEvents.Should().NotContain(e => e.Reason == "speaker-own-mark" || e.Reason == "mark-without-confirm-authority");

        // (f) The column itself refuses a basis that is neither word (a CHECK binds every role).
        var refused = async () => await ExecOnSuperuserAsync(
            "UPDATE ssf.verification_events SET review_basis = 'listened' WHERE daily_log_id = @id", ("id", logId));
        await refused.Should().ThrowAsync<PostgresException>().Where(e => e.SqlState == "23514");
    }

    [Fact]
    public async Task The_old_result_screen_tap_is_the_speakers_mark_and_only_a_deliberate_confirmation_counts()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        // The I13 "पक्कं आहे" from the record's own speaker (granted मुकादम): no review basis.
        var mukadamLog = Guid.NewGuid();
        await PushAppliedAsync(Mukadam, "create_daily_log", "i27-muk-create", CreatePayload(mukadamLog, Mukadam, voiceClipId: null));
        await PushAppliedAsync(Mukadam, "verify_log_v2", "i27-muk-own", VerifyPayload(mukadamLog, Mukadam));
        var mukadamEvents = await ReadEventsAsync(mukadamLog);
        output.WriteLine($"[EVIDENCE] granted मुकादम on his own record: {Describe(mukadamEvents)}");
        mukadamEvents.Should().NotContain(e => e.Status == "Verified");
        mukadamEvents.Select(e => e.Status).Should().Equal("Draft", "Draft");
        mukadamEvents[^1].Reason.Should().Be("speaker-own-mark");
        var pulled = await PullDailyLogAsync(Owner, mukadamLog);
        pulled.LastVerificationStatus.Should().Be("Draft", "his own tap is never the owner's confirmation");
        pulled.VerificationEvents.Should().BeEmpty("a mark never reaches a phone that reads any event as a confirmation");
        (await ScalarOnSuperuserAsync(
            "SELECT COUNT(*) FROM ssf.audit_events WHERE entity_id = @id AND action = 'ConfirmRequestNotCounted'",
            ("id", mukadamLog))).Should().Be(1L, "the tap is audited as not counted");

        // Founder 2026-08-27 still stands: a granted मुकादम may confirm his own record DELIBERATELY
        // (the review sheet states how he reviewed it). Never asked, but allowed.
        await PushAppliedAsync(Mukadam, "verify_log_v2", "i27-muk-deliberate", VerifyPayload(mukadamLog, Mukadam, "read", logVersion: 1));
        var mukadamVerified = (await ReadEventsAsync(mukadamLog)).Single(e => e.Status == "Verified");
        mukadamVerified.By.Should().Be(Mukadam);
        mukadamVerified.Basis.Should().Be("read");

        var ownerLog = Guid.NewGuid();
        await PushAppliedAsync(Owner, "create_daily_log", "i27-own-create", CreatePayload(ownerLog, Owner, voiceClipId: null));
        (await PullDailyLogAsync(Owner, ownerLog)).LastVerificationStatus.Should().Be("Draft", "his own voice log stays पक्कं नाही");
        // Even the owner's old I13 tap is his mark (I27 amends I13); his new "save and confirm" states heard/read.
        await PushAppliedAsync(Owner, "verify_log_v2", "i27-own-old-tap", VerifyPayload(ownerLog, Owner));
        (await PullDailyLogAsync(Owner, ownerLog)).LastVerificationStatus.Should().Be("Draft");
        await PushAppliedAsync(Owner, "verify_log_v2", "i27-own-confirm", VerifyPayload(ownerLog, Owner, "heard", logVersion: 1));
        var ownerVerified = (await ReadEventsAsync(ownerLog)).Single(e => e.Status == "Verified");
        ownerVerified.By.Should().Be(Owner);
        ownerVerified.Basis.Should().Be("heard");
        ownerVerified.Version.Should().Be(1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. WHO MAY REPLAY
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Replay_is_for_reviewers_of_that_record_only_and_only_under_the_speakers_current_consent()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var clip = Guid.NewGuid();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "i27-replay-create", CreatePayload(logId, Worker, clip));
        await SeedRetainedClipAsync(clip, Worker);

        // Switch OFF: nobody hears it; the transcript is untouched.
        await SetVoiceKeepAsync(Worker, on: false, words: CurrentVoiceWords);
        (await ReplayAsync(Owner, logId)).UnavailableReason.Should().Be("not_kept");

        // ON, but chosen before the current words existed (pre-L5): not re-confirmed, so not counted.
        await SetVoiceKeepAsync(Worker, on: true, words: null);
        (await ReplayAsync(Owner, logId)).UnavailableReason.Should().Be("not_kept");

        // OPS-1 (H5): an ON chosen against the words before the D-50 rename names the same listeners, so it STILL plays: renaming
        // the switch must not silently stop playback, and nobody has to re-confirm. Words nobody ever sent still do not count.
        await SetVoiceKeepAsync(Worker, on: true, words: PreRenameVoiceWords);
        (await ReplayAsync(Owner, logId)).Available.Should().BeTrue("an ON given under the pre-rename words keeps working");
        await SetVoiceKeepAsync(Worker, on: true, words: "voice-keep-never-sent");
        (await ReplayAsync(Owner, logId)).UnavailableReason.Should().Be("not_kept");

        // ON under the current words: the speaker, the primary owner and the granted मुकादम hear it.
        await SetVoiceKeepAsync(Worker, on: true, words: CurrentVoiceWords);
        foreach (var listener in new[] { Owner, Mukadam, Worker })
        {
            var voice = await ReplayAsync(listener, logId);
            output.WriteLine($"[EVIDENCE] replay as {listener} -> available={voice.Available}");
            voice.Available.Should().BeTrue();
            voice.ClipId.Should().Be(clip);
            voice.CipherBase64.Should().Be(Convert.ToBase64String(SealedBytes));
        }

        // Refused: a member without the grant, a co-owner by role alone; another farm cannot see it.
        // (FIX B, below, adds the erasure request at the very end of this fact.)
        foreach (var refused in new[] { UngrantedWorker, CoOwner })
        {
            var result = await ReplayResultAsync(refused, logId);
            output.WriteLine($"[EVIDENCE] replay as {refused} -> {result.Error.Code}");
            result.IsSuccess.Should().BeFalse();
            result.Error.Code.Should().Be("ShramSafal.ReadNotAllowed");
        }

        var foreign = await ReplayResultAsync(OtherFarmOwner, logId);
        output.WriteLine($"[EVIDENCE] replay as another farm's owner -> {foreign.Error.Code}");
        foreign.IsSuccess.Should().BeFalse();
        foreign.Error.Code.Should().Be("ShramSafal.DailyLogNotFound");

        // The record links only the SPEAKER's own clip: a link naming someone else's recording finds nothing.
        var borrowed = Guid.NewGuid();
        var borrowLog = Guid.NewGuid();
        await SeedRetainedClipAsync(borrowed, Owner);
        await PushAppliedAsync(Worker, "create_daily_log", "i27-borrow", CreatePayload(borrowLog, Worker, borrowed));
        (await ReplayAsync(Owner, borrowLog)).UnavailableReason.Should().Be("not_on_server");

        // A typed record (no link) has no recording to offer.
        var typed = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "i27-typed", CreatePayload(typed, Worker, voiceClipId: null, autoSaved: false));
        (await ReplayAsync(Owner, typed)).UnavailableReason.Should().Be("no_recording");

        // Review S4 — the erasure question is asked BEFORE a byte is read. When it cannot be
        // answered the voice is not played (not_kept) and the archive is never even read.
        var control = await ReplayWithStandInsAsync(Owner, logId, erasureCheck: null);
        control.Result.Value!.Available.Should().BeTrue("control: the real check, the clip is read and played");
        control.ArchiveReads.Should().Be(1);
        var unreadable = await ReplayWithStandInsAsync(Owner, logId, new ThrowingErasureCheck());
        output.WriteLine($"[EVIDENCE] erasure state unreadable -> {unreadable.Result.Value?.UnavailableReason}, archive reads={unreadable.ArchiveReads}");
        unreadable.Result.IsSuccess.Should().BeTrue();
        unreadable.Result.Value!.Available.Should().BeFalse();
        unreadable.Result.Value!.UnavailableReason.Should().Be("not_kept");
        unreadable.Result.Value!.CipherBase64.Should().BeNull();
        unreadable.ArchiveReads.Should().Be(0, "the erasure check runs before the clip is fetched");

        // FIX B — once the speaker asks for his account to be erased, nobody hears him any more,
        // even before the erasure run removes the clip: unavailable, exactly as with the switch OFF.
        (await ReplayAsync(Owner, logId)).Available.Should().BeTrue("control: still playable a moment before");
        await ExecOnSuperuserAsync(
            "INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc) VALUES (@id, @u, NULL, 0, now())",
            ("id", Guid.NewGuid()), ("u", Worker));
        foreach (var listener in new[] { Owner, Mukadam, Worker })
        {
            var afterErasure = await ReplayAsync(listener, logId);
            output.WriteLine($"[EVIDENCE] erasure requested, replay as {listener} -> {afterErasure.UnavailableReason}");
            afterErasure.Available.Should().BeFalse();
            afterErasure.UnavailableReason.Should().Be("not_kept");
            afterErasure.CipherBase64.Should().BeNull("not a byte of his voice leaves the server");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. FIX A — THE PRIMARY OWNER DECIDES WHO CONFIRMS, A CO-OWNER INCLUDED
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_primary_owner_gives_and_takes_back_a_co_owners_confirming_and_a_co_owner_cannot_grant()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        // (1) The primary owner gives the co-owner the responsibility: his confirmation now counts.
        var given = await SetPermissionAsync(Owner, CoOwner, allowed: true);
        given.IsSuccess.Should().BeTrue(given.Error?.ToString());
        given.Value!.CanConfirmRecords.Should().Be(true);
        // lane 2b (D-22 / D-26): a सहमालक's हजेरी is a real switch now, so an installed phone gets a
        // working "हजेरी व पक्कं" switch for him (its PUT keeps meaning both).
        given.Value!.IsGrantEditable.Should().BeTrue("a co-owner label carries nothing; his switch is real (lane 2b)");
        (await GrantFlagAsync(CoOwner)).Should().BeTrue("stored, as the app role");

        var first = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "i27-co-create-1", CreatePayload(first, Worker, voiceClipId: null));
        await PushAppliedAsync(CoOwner, "verify_log_v2", "i27-co-confirm-1", VerifyPayload(first, CoOwner, "read", logVersion: 1));
        var confirmed = (await ReadEventsAsync(first)).Single(e => e.Status == "Verified");
        output.WriteLine($"[EVIDENCE] co-owner with the owner's switch: {Describe(await ReadEventsAsync(first))}");
        confirmed.By.Should().Be(CoOwner);
        confirmed.Basis.Should().Be("read");

        // (2) The primary owner takes back CONFIRMING only (lane 2b: the one owner route, the
        // whole desired set without ConfirmRecords): the co-owner's next confirm is only his mark.
        var current = given.Value!.Authorities!;
        var takenBack = await RunUnderScopeAsync(Owner, sp => new ManageMembershipHandler(
                sp.GetRequiredService<IShramSafalRepository>(), sp.GetRequiredService<IClock>())
            .HandleAsync(new ManageMembershipCommand(
                new FarmId(FarmA), new UserId(CoOwner), new UserId(Owner), MembershipDecision.SetAuthorities,
                Authorities: current.Where(a => a.Name != "ConfirmRecords").ToList())));
        takenBack.IsSuccess.Should().BeTrue(takenBack.Error?.ToString());
        takenBack.Value!.CanConfirmRecords.Should().Be(false);
        var second = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "i27-co-create-2", CreatePayload(second, Worker, voiceClipId: null));
        await PushAppliedAsync(CoOwner, "verify_log_v2", "i27-co-confirm-2", VerifyPayload(second, CoOwner, "heard", logVersion: 1));
        var marked = await ReadEventsAsync(second);
        output.WriteLine($"[EVIDENCE] co-owner after the switch was taken back: {Describe(marked)}");
        marked.Should().NotContain(e => e.Status == "Verified");
        marked[^1].Reason.Should().Be("mark-without-confirm-authority");

        // His हजेरी is a separate authority the owner left ON (lane 2b) — not his label.
        (await RunUnderScopeAsync(CoOwner, sp => LabourManagementGate.IsAllowedAsync(
            sp.GetRequiredService<IShramSafalRepository>(), FarmA, CoOwner, DateTime.UtcNow))).Should().BeTrue();

        // (3) A co-owner trying to give the switch — to a worker, or back to himself — is refused,
        // and nothing is stored.
        foreach (var target in new[] { UngrantedWorker, CoOwner })
        {
            var before = await GrantFlagAsync(target);
            var refused = await SetPermissionAsync(CoOwner, target, allowed: true);
            output.WriteLine($"[EVIDENCE] co-owner grants {target} -> {refused.Error?.Code}");
            refused.IsSuccess.Should().BeFalse();
            refused.Error.Code.Should().Be("ShramSafal.Forbidden");
            // Nothing moved (the co-owner's OWN हजेरी is the primary owner's earlier choice).
            (await GrantFlagAsync(target)).Should().Be(before);
        }
        (await GrantFlagAsync(UngrantedWorker)).Should().BeFalse();

        // (4) lane 2b (D-26): the team list is the primary owner's — a co-owner is refused it.
        var roster = await RunUnderScopeAsync(CoOwner, sp => new GetLabourPermissionsHandler(
                sp.GetRequiredService<IShramSafalRepository>(), sp.GetRequiredService<IClock>())
            .HandleAsync(new GetLabourPermissionsQuery(new FarmId(FarmA), new UserId(CoOwner))));
        roster.IsSuccess.Should().BeFalse();
        roster.Error.Code.Should().Be("ShramSafal.Forbidden");

        // (5) An installed phone's one switch, turned OFF, takes both हजेरी and confirming (P11).
        var oldPhoneOff = await SetPermissionAsync(Owner, CoOwner, allowed: false);
        oldPhoneOff.IsSuccess.Should().BeTrue(oldPhoneOff.Error?.ToString());
        oldPhoneOff.Value!.CanManageLabourRecords.Should().BeFalse();
        oldPhoneOff.Value!.CanConfirmRecords.Should().Be(false);
        (await RunUnderScopeAsync(CoOwner, sp => LabourManagementGate.IsAllowedAsync(
            sp.GetRequiredService<IShramSafalRepository>(), FarmA, CoOwner, DateTime.UtcNow))).Should().BeFalse();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. REVIEW B1 — ONLY THE PRIMARY OWNER'S OWN SAVE IS CONFIRMED AT SAVE
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Only_the_primary_owners_own_save_is_confirmed_at_save_a_co_owners_stays_pending()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        // (1) The primary owner's own typed save, as an installed phone sends it: Verified at
        // save, and the confirmation records the version it covered with no review basis.
        var ownerLog = Guid.NewGuid();
        await PushAppliedAsync(Owner, "create_daily_log", "b1-owner-create", OldPhoneTypedCreate(ownerLog, Owner));
        var ownerEvents = await ReadEventsAsync(ownerLog);
        output.WriteLine($"[EVIDENCE] primary owner's own typed save: {Describe(ownerEvents)}");
        ownerEvents.Select(e => e.Status).Should().Equal("Confirmed", "Verified");
        var ownerVerified = ownerEvents.Single(e => e.Status == "Verified");
        ownerVerified.By.Should().Be(Owner);
        ownerVerified.Reason.Should().Be("self-attested-at-creation");
        ownerVerified.Version.Should().Be(1);
        ownerVerified.Basis.Should().BeNull("he wrote it himself: neither heard nor read");
        (await PullDailyLogAsync(Owner, ownerLog)).LastVerificationStatus.Should().Be("Verified");

        // (2) A co-owner's own typed save from an installed phone: below Verified, nothing written.
        var coLog = Guid.NewGuid();
        await PushAppliedAsync(CoOwner, "create_daily_log", "b1-co-create", OldPhoneTypedCreate(coLog, CoOwner));
        var coEvents = await ReadEventsAsync(coLog);
        output.WriteLine($"[EVIDENCE] co-owner's own typed save: {(coEvents.Count == 0 ? "(no events) Draft" : Describe(coEvents))}");
        coEvents.Should().BeEmpty();
        (await PullDailyLogAsync(CoOwner, coLog)).LastVerificationStatus.Should().Be("Draft");

        // (3) Even holding the owner's switch, his own save is not confirmed by the server.
        (await SetPermissionAsync(Owner, CoOwner, allowed: true)).IsSuccess.Should().BeTrue();
        var coLog2 = Guid.NewGuid();
        await PushAppliedAsync(CoOwner, "create_daily_log", "b1-co-create-2", CreatePayload(coLog2, CoOwner, voiceClipId: null, autoSaved: false));
        (await ReadEventsAsync(coLog2)).Should().BeEmpty("the grant is a deliberate act in the review sheet, never a save");

        // (4) The add-task re-attest: the owner confirmed the co-owner's day; the co-owner adds a
        // task to it. The day re-opens and stays pending — even with the switch on.
        await PushAppliedAsync(Owner, "verify_log_v2", "b1-owner-confirms-co", VerifyPayload(coLog, Owner, "read", logVersion: 1));
        await PushAppliedAsync(CoOwner, "add_log_task", "b1-co-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = coLog,
            ["activityType"] = "irrigation",
        });
        var afterTask = await ReadEventsAsync(coLog);
        output.WriteLine($"[EVIDENCE] co-owner adds a task to his confirmed day: {Describe(afterTask)}");
        afterTask[^1].Status.Should().Be("Draft");
        afterTask.Should().ContainSingle(e => e.Status == "Verified", "only the owner's earlier confirmation, none after the task");
        (await ContentVersionAsync(coLog)).Should().Be(2);
        (await PullDailyLogAsync(CoOwner, coLog)).LastVerificationStatus.Should().Be("Draft");

        // (5) A grant holder may still confirm his own day DELIBERATELY (founder 2026-08-27).
        await PushAppliedAsync(CoOwner, "verify_log_v2", "b1-co-deliberate", VerifyPayload(coLog2, CoOwner, "read", logVersion: 1));
        (await ReadEventsAsync(coLog2)).Single(e => e.Status == "Verified").By.Should().Be(CoOwner);

        // (6) The primary owner's own add-task re-attest still lands Verified, at the new version.
        await PushAppliedAsync(Owner, "add_log_task", "b1-owner-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = ownerLog,
            ["activityType"] = "spraying",
        });
        var ownerAfterTask = await ReadEventsAsync(ownerLog);
        output.WriteLine($"[EVIDENCE] primary owner adds a task to his own day: {Describe(ownerAfterTask)}");
        ownerAfterTask[^1].Status.Should().Be("Verified");
        ownerAfterTask[^1].Version.Should().Be(2);
        ownerAfterTask[^1].Basis.Should().BeNull();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. REVIEW S2 + S8 — A DISPUTE IS THE OWNER'S DECISION; THE v1 WIRE, PINNED
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_dispute_needs_the_same_authority_and_the_v1_wire_keeps_its_meaning()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        // S8 (a) — a granted मुकादम approves his OWN day through the v1 wire, confirmed then verified.
        var mukadamLog = Guid.NewGuid();
        await PushAppliedAsync(Mukadam, "create_daily_log", "s8-muk-create", OldPhoneTypedCreate(mukadamLog, Mukadam));
        await PushAppliedAsync(Mukadam, "verify_log", "s8-muk-confirmed", V1VerifyPayload(mukadamLog, Mukadam, "Confirmed"));
        await PushAppliedAsync(Mukadam, "verify_log", "s8-muk-verified", V1VerifyPayload(mukadamLog, Mukadam, "Verified"));
        var mukadamEvents = await ReadEventsAsync(mukadamLog);
        output.WriteLine($"[EVIDENCE] v1 granted मुकादम on his own day: {Describe(mukadamEvents)}");
        mukadamEvents[^1].Status.Should().Be("Verified");
        mukadamEvents[^1].By.Should().Be(Mukadam);
        mukadamEvents[^1].Version.Should().Be(1);
        (await PullDailyLogAsync(Owner, mukadamLog)).LastVerificationStatus.Should().Be("Verified");

        // S8 (b) — a co-owner without the switch sends the v1 confirmed + verified pair: the
        // first step stands (anyone may confirm a day was recorded), the second is his mark.
        var workerLog = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "s8-worker-create", CreatePayload(workerLog, Worker, voiceClipId: null));
        await PushAppliedAsync(CoOwner, "verify_log", "s8-co-confirmed", V1VerifyPayload(workerLog, CoOwner, "Confirmed"));
        await PushAppliedAsync(CoOwner, "verify_log", "s8-co-verified", V1VerifyPayload(workerLog, CoOwner, "Verified"));
        var coPair = await ReadEventsAsync(workerLog);
        output.WriteLine($"[EVIDENCE] v1 co-owner pair: {Describe(coPair)}");
        coPair[^1].Status.Should().Be("Confirmed");
        coPair.Should().NotContain(e => e.Status == "Verified");
        (await PullDailyLogAsync(Owner, workerLog)).LastVerificationStatus.Should().Be("Confirmed");
        (await NotCountedAuditsAsync(workerLog)).Should().Be(1L);

        // S2 — the owner confirms the worker's day; a co-owner without the switch disputes it.
        await PushAppliedAsync(Owner, "verify_log_v2", "s2-owner-confirm", VerifyPayload(workerLog, Owner, "heard", logVersion: 1));
        await PushAppliedAsync(CoOwner, "verify_log_v2", "s2-co-dispute-v2", DisputePayload(workerLog, CoOwner));
        await PushAppliedAsync(CoOwner, "verify_log", "s2-co-dispute-v1", V1VerifyPayload(workerLog, CoOwner, "rejected", "काम अपूर्ण"));
        var afterMarks = await ReadEventsAsync(workerLog);
        output.WriteLine($"[EVIDENCE] co-owner disputes without the switch (v2 + v1): {Describe(afterMarks)}");
        afterMarks[^1].Status.Should().Be("Verified", "his dispute is a mark: the status does not move");
        afterMarks.Should().NotContain(e => e.Status == "Disputed");
        (await NotCountedAuditsAsync(workerLog)).Should().Be(3L, "each one audited as not counted");
        var pulled = await PullDailyLogAsync(Owner, workerLog);
        pulled.LastVerificationStatus.Should().Be("Verified");
        pulled.VerificationEvents.Should().NotContain(e => e.Reason == "mark-without-confirm-authority");

        // A worker is refused, exactly as before.
        var workerDispute = await PushResultAsync(Worker, "verify_log_v2", "s2-worker-dispute", DisputePayload(workerLog, Worker));
        output.WriteLine($"[EVIDENCE] worker disputes -> {workerDispute.Status} {workerDispute.ErrorCode}");
        workerDispute.Status.Should().Be("failed");
        workerDispute.ErrorCode.Should().Be("ShramSafal.Forbidden");

        // With the primary owner's switch, the co-owner's dispute counts.
        (await SetPermissionAsync(Owner, CoOwner, allowed: true)).IsSuccess.Should().BeTrue();
        await PushAppliedAsync(CoOwner, "verify_log_v2", "s2-co-dispute-granted", DisputePayload(workerLog, CoOwner));
        var disputed = await ReadEventsAsync(workerLog);
        output.WriteLine($"[EVIDENCE] co-owner with the switch disputes: {Describe(disputed)}");
        disputed[^1].Status.Should().Be("Disputed");
        disputed[^1].By.Should().Be(CoOwner);
        (await PullDailyLogAsync(Owner, workerLog)).LastVerificationStatus.Should().Be("Disputed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. REVIEW S1 — THE LABOUR SCREEN SAYS WHETHER THIS VIEWER'S CONFIRMATION COUNTS
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_labour_screen_tells_each_viewer_whether_his_confirmation_counts()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        foreach (var (viewer, expected) in new[]
        {
            (Owner, true), (CoOwner, false), (UngrantedWorker, false), (Mukadam, true),
        })
        {
            var canConfirm = await CanConfirmAsync(viewer);
            output.WriteLine($"[EVIDENCE] labour screen canConfirm for {viewer} -> {canConfirm}");
            canConfirm.Should().Be(expected);
        }

        (await SetPermissionAsync(Owner, CoOwner, allowed: true)).IsSuccess.Should().BeTrue();
        (await CanConfirmAsync(CoOwner)).Should().Be(true, "the primary owner gave him the switch");
        (await SetPermissionAsync(Owner, CoOwner, allowed: false)).IsSuccess.Should().BeTrue();
        (await CanConfirmAsync(CoOwner)).Should().Be(false, "and took it back");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. LANE L6b — WHAT HE TYPES TO SATHI IS A CAPTURE, NOT A CONFIRMATION
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b; founder D-44 / D-46). The typed sheet's
    /// "साथीला पाठवा" now saves at once, like a spoken entry, and reaches the server as the auto-save create with
    /// no recording named. Even from the PRIMARY OWNER — whose typed save from the old review form is confirmed at
    /// save — it must land UNCONFIRMED, and only his deliberate "पक्कं आहे" (read, never heard) confirms it.
    /// </summary>
    [Fact]
    public async Task A_typed_auto_save_stays_unconfirmed_even_for_the_primary_owner_until_his_own_confirm()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        // Exactly what the L6b phone queues for a typed entry: the auto-save flag, and no voiceClipId key at all.
        var typedLog = Guid.NewGuid();
        var typedCreate = CreatePayload(typedLog, Owner, voiceClipId: null);
        typedCreate.Keys.Should().NotContain("voiceClipId");
        typedCreate["autoSavedFromVoice"].Should().Be(true);
        await PushAppliedAsync(Owner, "create_daily_log", "l6b-typed-autosave", typedCreate);

        var typedEvents = await ReadEventsAsync(typedLog);
        output.WriteLine($"[EVIDENCE] primary owner's typed auto-save: {Describe(typedEvents)}");
        typedEvents.Select(e => e.Status).Should().Equal(new[] { "Draft" }, "a capture is not a confirmation");
        typedEvents.Single().Reason.Should().Be("auto-saved-from-voice");
        (await PullDailyLogAsync(Owner, typedLog)).LastVerificationStatus.Should().Be("Draft", "पक्कं नाही on every phone");
        (await ScalarOnSuperuserAsync(
            "SELECT voice_clip_id FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", typedLog))).Should().Be(DBNull.Value, "no recording is behind it");

        // Control: the same owner's typed save from the old review form (an installed phone) IS confirmed at save.
        var formLog = Guid.NewGuid();
        await PushAppliedAsync(Owner, "create_daily_log", "l6b-form-save", OldPhoneTypedCreate(formLog, Owner));
        (await ReadEventsAsync(formLog)).Select(e => e.Status).Should().Equal("Confirmed", "Verified");

        // His "✔ पक्कं आहे" on the result screen — read, there is nothing to hear — confirms it, at version 1.
        await PushAppliedAsync(Owner, "verify_log_v2", "l6b-typed-confirm", VerifyPayload(typedLog, Owner, "read", logVersion: 1));
        var confirmed = (await ReadEventsAsync(typedLog)).Single(e => e.Status == "Verified");
        output.WriteLine($"[EVIDENCE] after his own confirm: {Describe(await ReadEventsAsync(typedLog))}");
        confirmed.By.Should().Be(Owner);
        confirmed.Basis.Should().Be("read");
        confirmed.Version.Should().Be(1);
        (await PullDailyLogAsync(Owner, typedLog)).LastVerificationStatus.Should().Be("Verified");
    }

    private async Task<bool?> CanConfirmAsync(Guid viewer)
    {
        var result = await RunUnderScopeAsync(viewer, sp => sp.GetRequiredService<IHandler<GetLabourDataQuery, LabourDataDto>>()
            .HandleAsync(new GetLabourDataQuery(new FarmId(FarmA), new UserId(viewer))));
        result.IsSuccess.Should().BeTrue("the labour read must answer: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.CanConfirm;
    }

    private async Task<long> NotCountedAuditsAsync(Guid logId) => Convert.ToInt64(await ScalarOnSuperuserAsync(
        "SELECT COUNT(*) FROM ssf.audit_events WHERE entity_id = @id AND action = 'ConfirmRequestNotCounted'",
        ("id", logId)));

    /// <summary>A typed save exactly as an installed phone (1.0.15–1.0.17) sends it: no auto-save flag at all.</summary>
    private static Dictionary<string, object?> OldPhoneTypedCreate(Guid dailyLogId, Guid speaker)
    {
        var payload = CreatePayload(dailyLogId, speaker, voiceClipId: null);
        payload.Remove("autoSavedFromVoice");
        return payload;
    }

    private static Dictionary<string, object?> V1VerifyPayload(Guid logId, Guid verifier, string status, string? reason = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["verificationEventId"] = Guid.NewGuid(),
            ["dailyLogId"] = logId,
            ["status"] = status,
            ["verifiedByUserId"] = verifier,
        };
        if (reason is not null)
        {
            payload["reason"] = reason;
        }

        return payload;
    }

    private static Dictionary<string, object?> DisputePayload(Guid logId, Guid verifier) => new()
    {
        ["logId"] = logId,
        ["verifierUserId"] = verifier,
        ["decision"] = "dispute",
        ["reason"] = "काम अपूर्ण",
        ["decidedAt"] = DateTime.UtcNow.ToString("O"),
    };

    private async Task<(AgriSync.BuildingBlocks.Results.Result<LogOriginalVoiceResult> Result, int ArchiveReads)> ReplayWithStandInsAsync(
        Guid caller, Guid logId, IAccountErasureCheck? erasureCheck)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().SetUserScoped(caller);
        var archive = new CountingArchive(sp.GetRequiredService<IRetainedBlobStore>());
        var handler = new GetLogOriginalVoiceHandler(
            sp.GetRequiredService<IShramSafalRepository>(),
            archive,
            erasureCheck ?? sp.GetRequiredService<IAccountErasureCheck>(),
            sp.GetRequiredService<IClock>(),
            NullLogger<GetLogOriginalVoiceHandler>.Instance);
        var result = await handler.HandleAsync(new GetLogOriginalVoiceQuery(logId, caller));
        return (result, archive.Reads);
    }

    private sealed class ThrowingErasureCheck : IAccountErasureCheck
    {
        public Task<bool> IsErasureRequestedAsync(Guid userId, CancellationToken ct = default)
            => throw new InvalidOperationException("erasure state unreadable (test stand-in)");
    }

    private sealed class CountingArchive(IRetainedBlobStore inner) : IRetainedBlobStore
    {
        public int Reads { get; private set; }

        public Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct)
            => inner.DeleteRetainedVoiceForUserAsync(userId, ct);

        public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct)
            => inner.PersistAsync(metadata, cipherBytes, ct);

        public Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct)
        {
            Reads++;
            return inner.GetByIdAsync(clipId, callerUserId, ct);
        }

        public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
            => inner.GetByRangeAsync(userId, from, to, ct);
    }

    private Task<AgriSync.BuildingBlocks.Results.Result<LabourPermissionDto>> SetPermissionAsync(Guid caller, Guid target, bool allowed)
        => RunUnderScopeAsync(caller, sp => new SetLabourPermissionHandler(
                sp.GetRequiredService<IShramSafalRepository>(), sp.GetRequiredService<IClock>())
            .HandleAsync(new SetLabourPermissionCommand(
                new FarmId(FarmA), new UserId(target), allowed, new UserId(caller),
                "test", "device-test", "sha256:test", null)));

    /// <summary>The request scope exactly as production runs it: admin-elevated interceptor, the
    /// caller's and the farm's GUCs inside the ambient transaction (LabourCapabilityGrantRealPostgresTests).</summary>
    private async Task<T> RunUnderScopeAsync<T>(Guid caller, Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.user_id', {caller.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.farm_id', {FarmA.ToString()}, true)");
        var result = await body(sp);
        await tx.CommitAsync();
        return result;
    }

    private async Task<bool> GrantFlagAsync(Guid user) => Convert.ToBoolean(await ScalarOnSuperuserAsync(
        "SELECT can_manage_labour_records FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u",
        ("f", FarmA), ("u", user)));

    // ─────────────────────────────────────────────────────────────────────────
    // Harness.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record StoredEvent(string Status, string? Reason, Guid By, int? Version, string? Basis);

    private static string Describe(IEnumerable<StoredEvent> events) =>
        string.Join(" -> ", events.Select(e => $"{e.Status}({e.Reason ?? "-"}{(e.Version is { } v ? $", v{v}, {e.Basis}" : "")})"));

    private static Dictionary<string, object?> CreatePayload(Guid dailyLogId, Guid speaker, Guid? voiceClipId, bool autoSaved = true)
    {
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["operatorUserId"] = speaker,
            ["logDate"] = "2026-10-30",
            ["autoSavedFromVoice"] = autoSaved,
        };
        if (voiceClipId is { } clip)
        {
            payload["voiceClipId"] = clip;
        }

        return payload;
    }

    private static Dictionary<string, object?> VerifyPayload(Guid logId, Guid verifier, string? basis = null, int? logVersion = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["logId"] = logId,
            ["verifierUserId"] = verifier,
            ["decision"] = "verify",
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        };
        if (basis is not null)
        {
            payload["reviewBasis"] = basis;
        }

        if (logVersion is { } v)
        {
            payload["logVersion"] = v;
        }

        return payload;
    }

    private async Task<int> ContentVersionAsync(Guid logId) => Convert.ToInt32(await ScalarOnSuperuserAsync(
        "SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId)));

    private async Task<List<StoredEvent>> ReadEventsAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT status, reason, verified_by_user_id, confirmed_log_version, review_basis
            FROM ssf.verification_events WHERE daily_log_id = @id ORDER BY occurred_at_utc
            """;
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<StoredEvent>();
        while (await reader.ReadAsync())
        {
            rows.Add(new StoredEvent(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetGuid(2),
                reader.IsDBNull(3) ? null : reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetString(4)));
        }

        return rows;
    }

    // ── fix round 2, N2 (founder D-2: OFF stops replay, never deletes; D-50 choice 2: the switch is "who may listen") ──
    private async Task<(VoiceDiaryByIdOutcome Outcome, bool HasBytes)> VoiceDiaryByIdAsync(Guid caller, Guid clip)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant(); // /voice-diary is on the admin skip-list, as in the real host
        var r = await sp.GetRequiredService<GetVoiceDiaryByIdHandler>().HandleAsync(clip, caller);
        return (r.Outcome, r.Clip is not null && r.Clip.CipherBytes.Length > 0);
    }

    [Fact]
    public async Task Voice_diary_own_clip_is_refused_while_the_switch_is_off_kept_and_played_again_when_it_is_on()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var clip = Guid.NewGuid();
        await SeedRetainedClipAsync(clip, Worker);

        // OFF: the speaker's OWN clip is refused (before it is read from storage), but it is kept.
        await SetVoiceKeepAsync(Worker, on: false, words: CurrentVoiceWords);
        (await VoiceDiaryByIdAsync(Worker, clip)).Outcome.Should().Be(VoiceDiaryByIdOutcome.SwitchOff);
        Convert.ToInt64(await ScalarOnSuperuserAsync("SELECT count(*) FROM ssf.voice_clips_retained WHERE clip_id = @c", ("c", clip)))
            .Should().Be(1, "OFF never deletes the kept clip");

        // ON under the current words: plays. ON under the pre-rename words: plays (the same listeners). ON with no words
        // (before reviewers were disclosed): the speaker's own playback still works; only REVIEWERS need the words.
        foreach (var words in new string?[] { CurrentVoiceWords, PreRenameVoiceWords, null })
        {
            await SetVoiceKeepAsync(Worker, on: true, words: words);
            var on = await VoiceDiaryByIdAsync(Worker, clip);
            on.Outcome.Should().Be(VoiceDiaryByIdOutcome.Found, "ON under {0} plays", words ?? "no words");
            on.HasBytes.Should().BeTrue();
        }

        // Someone else's clip is never found, switch or no switch.
        (await VoiceDiaryByIdAsync(Owner, clip)).Outcome.Should().Be(VoiceDiaryByIdOutcome.SwitchOff, "the owner's own switch is OFF (no row)");
        await SetVoiceKeepAsync(Owner, on: true, words: CurrentVoiceWords);
        (await VoiceDiaryByIdAsync(Owner, clip)).Outcome.Should().Be(VoiceDiaryByIdOutcome.NotFound);

        // OFF again: refused again; ON again: playable again.
        await SetVoiceKeepAsync(Worker, on: false, words: CurrentVoiceWords);
        (await VoiceDiaryByIdAsync(Worker, clip)).Outcome.Should().Be(VoiceDiaryByIdOutcome.SwitchOff);
        await SetVoiceKeepAsync(Worker, on: true, words: CurrentVoiceWords);
        (await VoiceDiaryByIdAsync(Worker, clip)).Outcome.Should().Be(VoiceDiaryByIdOutcome.Found);
    }

    private async Task SeedRetainedClipAsync(Guid clipId, Guid owner) => await ExecOnSuperuserAsync("""
        INSERT INTO ssf.voice_clips_retained (clip_id, user_id, recorded_at_utc, s3_key, dek_id, iv_b64, auth_tag_b64, duration_seconds, language, created_at_utc)
        VALUES (@clip, @user, NOW(), @key, 'dek-1', 'aXY=', 'dGFn', 4, 'mr-IN', NOW());
        """, ("clip", clipId), ("user", owner), ("key", VoiceClipRetained.BuildS3Key(owner, clipId)));

    private async Task SetVoiceKeepAsync(Guid user, bool on, string? words)
    {
        await ExecOnSuperuserAsync("DELETE FROM ssf.user_consent_state WHERE user_id = @user", ("user", user));
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.user_consent_state (user_id, full_history_journal, cross_farm_aggregation, research_corpus_export,
                verbatim_training_corpus, english_translation_for_admin, version, full_history_journal_wording_version)
            VALUES (@user, @on, false, false, false, false, 1, @words);
            """, ("user", user), ("on", on), ("words", (object?)words ?? DBNull.Value));
    }

    private async Task<LogOriginalVoiceResult> ReplayAsync(Guid caller, Guid logId)
    {
        var result = await ReplayResultAsync(caller, logId);
        result.IsSuccess.Should().BeTrue("replay must answer: {0}", result.Error?.ToString() ?? "-");
        return result.Value!;
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<LogOriginalVoiceResult>> ReplayResultAsync(Guid caller, Guid logId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        // The endpoint runs user-scoped, exactly like every GET.
        sp.GetRequiredService<TenantContext>().SetUserScoped(caller);
        return await sp.GetRequiredService<GetLogOriginalVoiceHandler>()
            .HandleAsync(new GetLogOriginalVoiceQuery(logId, caller));
    }

    private async Task PushAppliedAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var result = await PushResultAsync(actor, mutationType, clientRequestId, payload);
        result.Status.Should().Be("applied", "{0} error='{1}: {2}'", mutationType, result.ErrorCode, result.ErrorMessage);
    }

    private async Task<SyncMutationResultDto> PushResultAsync(
        Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var push = await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(new PushSyncBatchCommand(
            DeviceId: $"device-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: "Worker",
            Mutations: [new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload))],
            AppVersion: "1.0.18"));
        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        return Assert.Single(push.Value!.Results);
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid user, Guid dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().SetUserScoped(user);
        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, user));
        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.Should().ContainSingle(l => l.Id == dailyLogId).Subject;
    }

    private async Task AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText =
            "SELECT current_user, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), current_database()";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        reader.GetString(0).Should().Be(AppRoleUser);
        reader.GetBoolean(1).Should().BeFalse();
        reader.GetString(2).Should().Be(_scratchDbName);
        output.WriteLine($"[PROVISIONING] role={reader.GetString(0)} superuser_or_bypassrls={reader.GetBoolean(1)}");
    }

    private async Task ExecOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
    }

    private async Task<object?> ScalarOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// The real archive read (its own ownership-filtered DB query) with the S3 bytes stood in for:
    /// there is no bucket on a throwaway cluster, and the bytes are opaque to the server anyway.
    /// </summary>
    private sealed class BytesFromS3StandIn(IRetainedBlobStore inner) : IRetainedBlobStore
    {
        public Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct)
            => inner.DeleteRetainedVoiceForUserAsync(userId, ct);

        public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct)
            => inner.PersistAsync(metadata, cipherBytes, ct);

        public async Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct)
        {
            var row = await inner.GetByIdAsync(clipId, callerUserId, ct);
            return row is null ? null : row with { CipherBytes = SealedBytes };
        }

        public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
            => inner.GetByRangeAsync(userId, from, to, ct);
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
