// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 B5; founder 28 Nov: "If there is any change, you can do it within 24 hours")
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
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// <b>"बदल करता येतो · २४ तास" on the real path</b> — <c>/sync/push</c> → Postgres → <c>/sync/pull</c>, as the
/// non-superuser <c>agrisync_app</c> role (E3: each fact first proves the role is neither superuser nor BYPASSRLS).
///
/// <list type="bullet">
///   <item>the pull hands the phone the talk's window exactly as the server stored it: <c>created_at_utc + 24 h</c>;</item>
///   <item>after 24 hours (the talk's <c>created_at_utc</c> moved back on the scratch database — the server's own clock
///   is the anchor, nothing the phone says moves it), the speaker's content revision, move and queued headcount
///   correction are each refused with <c>ShramSafal.LogEditWindow.Conflict</c> and NOTHING is written;</item>
///   <item>everyone else stays open on the same talk: the owner's revision, headcount correction (online route) and
///   confirmation; the speaker's own product answer and a late task line of his original save stay open too;</item>
///   <item>a record that is not a talk (the exact create a 1.0.15–1.0.17 phone sends) has no window: no key on the pull,
///   and the speaker's changes days later apply as before (P11).</item>
/// </list>
///
/// <para>Each fact builds its OWN scratch database (full migration chain) on the cluster named by
/// <c>REQUIRES_POSTGRES_ROOT_CONN</c> and drops it on dispose. Fail-loud: no reachable Postgres is a FAILURE.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class TalkEditWindowRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;
    private const string WindowClosed = "ShramSafal.LogEditWindow.Conflict";

    private static readonly Guid FarmA = Guid.Parse("b5e00000-0000-4000-8000-0000000000a1");
    private static readonly Guid OwnerA = Guid.Parse("b5e00000-0000-4000-8000-0000000000a2");
    private static readonly Guid AccountA = Guid.Parse("b5e00000-0000-4000-8000-0000000000a3");
    private static readonly Guid PlotA = Guid.Parse("b5e00000-0000-4000-8000-0000000000a4");
    private static readonly Guid CycleA = Guid.Parse("b5e00000-0000-4000-8000-0000000000a5");

    /// <summary>The speaker: a मुकादम the owner gave हजेरी (so he may correct a headcount), recording his own talks.</summary>
    private static readonly Guid SpeakerA = Guid.Parse("b5e00000-0000-4000-8000-0000000000a6");

    private static readonly string LogDay = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1).ToString("yyyy-MM-dd");
    private static readonly string DayBefore = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-2).ToString("yyyy-MM-dd");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_b5_window_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
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
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
                """);
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farmA, 'B5 Farm A', @ownerA, @accountA, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                VALUES (gen_random_uuid(), @farmA, @ownerA, 'PrimaryOwner', NOW(), NOW(), @accountA, 3);
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, can_manage_labour_records)
                VALUES (gen_random_uuid(), @farmA, @speakerA, 'Mukadam', NOW(), NOW(), @accountA, 3, TRUE);
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plotA, @farmA, 'Plot A', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycleA, @farmA, @plotA, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                """,
                ("farmA", FarmA), ("ownerA", OwnerA), ("accountA", AccountA), ("speakerA", SpeakerA),
                ("plotA", PlotA), ("cycleA", CycleA));

            // lane 2b (P11) - the seats as they stand on an UPGRADED farm.
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
        catch (Exception ex)
        {
            output.WriteLine($"[TEARDOWN] scratch database {_scratchDbName} was not dropped: {ex.GetType().Name}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. The phone is told the window; inside it the speaker's change lands.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_pull_carries_the_window_the_server_stored_and_inside_it_the_speakers_change_lands()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var (logId, _) = await SaveTalkAsync("req-b5-open-create");

        var storedAt = await CreatedAtAsync(logId);
        var pulled = await PullDailyLogAsync(SpeakerA, logId);
        output.WriteLine($"[EVIDENCE] created_at_utc={storedAt:O} editableUntilUtc={pulled.EditableUntilUtc:O}");
        pulled.EditableUntilUtc.Should().Be(storedAt.AddHours(24), "the window is the server's stored time plus 24 hours");
        pulled.EditableUntilUtc!.Value.Kind.Should().Be(DateTimeKind.Utc);
        (await PullDailyLogAsync(OwnerA, logId)).EditableUntilUtc.Should().Be(storedAt.AddHours(24),
            "every reader is told the speaker's window; it binds only the speaker");

        var revised = await PushAsync(SpeakerA, "revise_log_content", "req-b5-open-revise", RevisePayload(logId, 1, EditedContent()));
        revised.Status.Should().Be("applied", "{0}: {1}", revised.ErrorCode, revised.ErrorMessage);
        (await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. After 24 hours: the speaker's changes are refused whole; nothing moves.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task After_24_hours_the_speakers_revision_move_and_headcount_correction_are_refused_and_nothing_is_written()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var (logId, crewId) = await SaveTalkAsync("req-b5-closed-create");
        await StoredHoursAgoAsync(logId, 25);
        var before = await SnapshotAsync(logId, crewId);
        output.WriteLine($"[EVIDENCE] before: {before}");

        // His phone says he made the change an hour after saving; the server's clock says 25 hours (P10).
        var revise = RevisePayload(logId, 1, EditedContent());
        revise["revisedAtUtc"] = (await CreatedAtAsync(logId)).AddHours(1).ToString("O");
        var revised = await PushAsync(SpeakerA, "revise_log_content", "req-b5-closed-revise", revise);
        var moved = await PushAsync(SpeakerA, "move_daily_log", "req-b5-closed-move", new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["baseVersion"] = 1,
            ["newLogDate"] = DayBefore,
            ["reason"] = "दिवस बदला",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        var counted = await PushAsync(SpeakerA, "correct_labour_assignment", "req-b5-closed-count",
            CountPayload(crewId, logId, newCount: 6, seenCount: 8));

        foreach (var (what, result) in new[] { ("revise", revised), ("move", moved), ("count", counted) })
        {
            output.WriteLine($"[EVIDENCE] speaker {what} after 25 h -> {result.Status} {result.ErrorCode} | {result.ErrorMessage}");
            result.Status.Should().Be("failed");
            result.ErrorCode.Should().Be(WindowClosed);
            result.ErrorMessage.Should().EndWith("[reason:editWindowClosed]");
        }

        var after = await SnapshotAsync(logId, crewId);
        output.WriteLine($"[EVIDENCE] after: {after}");
        after.Should().Be(before, "a refused change writes nothing: no version, no content row, no day, no count, no event, no audit row");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Everyone and everything else stays open on the same talk.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task After_24_hours_the_owner_still_corrects_and_confirms_and_the_speakers_product_answer_and_late_task_line_land()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var (logId, crewId) = await SaveTalkAsync("req-b5-others-create");
        await StoredHoursAgoAsync(logId, 30);

        // The speaker's own answer about a product ("owner will check" can come days later) — an overlay, never locked.
        var answer = await PushAsync(SpeakerA, "assert_input_identity", "req-b5-others-answer", new Dictionary<string, object?>
        {
            ["assertionId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["dailyLogId"] = logId,
            ["inputEventId"] = "tm-input-0",
            ["mixIndex"] = 0,
            ["verdict"] = "rejected",
            ["catalogVersion"] = "inputs-2.4",
        });
        output.WriteLine($"[EVIDENCE] speaker's product answer after 30 h -> {answer.Status} {answer.ErrorCode}");
        answer.Status.Should().Be("applied", "{0}: {1}", answer.ErrorCode, answer.ErrorMessage);

        // A task line of his ORIGINAL save arriving late (an older phone sends each part as its own line right after the
        // create): it is the save itself trickling in, never refused (P10).
        var lateLine = await PushAsync(SpeakerA, "add_log_task", "req-b5-others-line", new Dictionary<string, object?>
        {
            ["logTaskId"] = Guid.NewGuid(),
            ["dailyLogId"] = logId,
            ["activityType"] = "Irrigation",
            ["occurredAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        output.WriteLine($"[EVIDENCE] speaker's late task line after 30 h -> {lateLine.Status} {lateLine.ErrorCode}");
        lateLine.Status.Should().Be("applied", "{0}: {1}", lateLine.ErrorCode, lateLine.ErrorMessage);
        var versionAfterLine = await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId);

        // The owner — another person — changes what the record says, on the queue and on the online count route.
        var ownerRevise = await PushAsync(OwnerA, "revise_log_content", "req-b5-others-owner-revise",
            RevisePayload(logId, versionAfterLine, EditedContent()));
        output.WriteLine($"[EVIDENCE] owner's revision after 30 h -> {ownerRevise.Status} {ownerRevise.ErrorCode}");
        ownerRevise.Status.Should().Be("applied", "{0}: {1}", ownerRevise.ErrorCode, ownerRevise.ErrorMessage);

        var ownerCount = await CorrectOnlineAsync(OwnerA, new CorrectLabourCommand(
            new FarmId(FarmA), crewId, new UserId(OwnerA), "device-b5-owner", "req-b5-others-owner-count",
            Reason: "मोजले", Quantity: new LabourQuantityCorrection(6, null, null), DurationHours: null,
            AttributionAdds: null, AttributionRemovals: null));
        output.WriteLine($"[EVIDENCE] owner's online headcount correction after 30 h -> {(ownerCount.IsSuccess ? "applied" : ownerCount.Error.Code)}");
        ownerCount.IsSuccess.Should().BeTrue(ownerCount.IsFailure ? ownerCount.Error.Code : string.Empty);
        (await ScalarIntAsync("SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", crewId)).Should().Be(6);

        // ... and confirms it (verification by the owner is never locked).
        var confirm = await PushAsync(OwnerA, "verify_log_v2", "req-b5-others-confirm", new Dictionary<string, object?>
        {
            ["logId"] = logId,
            ["verifierUserId"] = OwnerA,
            ["decision"] = "verify",
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
            ["reviewBasis"] = "heard",
        });
        output.WriteLine($"[EVIDENCE] owner's confirmation after 30 h -> {confirm.Status} {confirm.ErrorCode}");
        confirm.Status.Should().Be("applied", "{0}: {1}", confirm.ErrorCode, confirm.ErrorMessage);
        (await PullDailyLogAsync(OwnerA, logId)).LastVerificationStatus.Should().Be("Verified");

        // The speaker himself is still held to his window after all of that: none of it moved the anchor.
        var pulled = await PullDailyLogAsync(SpeakerA, logId);
        pulled.EditableUntilUtc.Should().Be((await CreatedAtAsync(logId)).AddHours(24));
        var stillClosed = await PushAsync(SpeakerA, "revise_log_content", "req-b5-others-speaker-again",
            RevisePayload(logId, pulled.ContentVersion ?? 1, EditedContent()));
        stillClosed.ErrorCode.Should().Be(WindowClosed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. P11 — a record that is not a talk (an older phone's exact create) has no window.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_older_phones_record_has_no_window_and_the_speakers_changes_days_later_apply_as_before()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = Guid.NewGuid();
        var crewId = Guid.NewGuid();
        // The keys a 1.0.15–1.0.17 phone sends: no content, no autoSavedFromVoice.
        await PushAppliedAsync(SpeakerA, "create_daily_log", "req-b5-old-create", OldCreatePayload(logId, crewId));
        await StoredHoursAgoAsync(logId, 24 * 10);

        var pulledJson = await PullDailyLogJsonAsync(SpeakerA, logId);
        output.WriteLine($"[EVIDENCE] older phone's record on the pull has editableUntilUtc key: {pulledJson.TryGetProperty("editableUntilUtc", out _)}");
        pulledJson.TryGetProperty("editableUntilUtc", out _).Should().BeFalse("no window, and no key on the wire: an old phone's bytes are unchanged");

        // 1.0.17 sends every count edit to the online route: it still lands, ten days later.
        var online = await CorrectOnlineAsync(SpeakerA, new CorrectLabourCommand(
            new FarmId(FarmA), crewId, new UserId(SpeakerA), "device-b5-old", "req-b5-old-count",
            Reason: null, Quantity: new LabourQuantityCorrection(6, null, null), DurationHours: null,
            AttributionAdds: null, AttributionRemovals: null));
        output.WriteLine($"[EVIDENCE] speaker's online count correction of an older phone's record after 10 days -> {(online.IsSuccess ? "applied" : online.Error.Code)}");
        online.IsSuccess.Should().BeTrue(online.IsFailure ? online.Error.Code : string.Empty);

        // A new phone editing that same older record: no window either.
        var version = await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId);
        var revised = await PushAsync(SpeakerA, "revise_log_content", "req-b5-old-revise", RevisePayload(logId, version, EditedContent()));
        output.WriteLine($"[EVIDENCE] speaker's revision of an older phone's record after 10 days -> {revised.Status} {revised.ErrorCode}");
        revised.Status.Should().Be("applied", "{0}: {1}", revised.ErrorCode, revised.ErrorMessage);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record Snapshot(
        int ContentVersion, long ContentRows, string LogDate, int? WorkerCount, long Events, long Corrections, long Audits);

    private async Task<Snapshot> SnapshotAsync(Guid logId, Guid crewId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT l.content_version,
                   (SELECT COUNT(*) FROM ssf.daily_log_contents c WHERE c.daily_log_id = l."Id"),
                   l.log_date::text,
                   (SELECT a.worker_count FROM ssf.labour_assignments a WHERE a."Id" = @crew),
                   (SELECT COUNT(*) FROM ssf.verification_events v WHERE v.daily_log_id = l."Id"),
                   (SELECT COUNT(*) FROM ssf.labour_corrections k WHERE k.labour_assignment_id = @crew),
                   (SELECT COUNT(*) FROM ssf.audit_events e WHERE e.entity_id = l."Id")
            FROM ssf.daily_logs l WHERE l."Id" = @id
            """;
        cmd.Parameters.AddWithValue("id", logId);
        cmd.Parameters.AddWithValue("crew", crewId);
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue();
        return new Snapshot(
            r.GetInt32(0), r.GetInt64(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetInt32(3),
            r.GetInt64(4), r.GetInt64(5), r.GetInt64(6));
    }

    /// <summary>A talk: saved straight from what he told Sathi (the new phone's create), with its details and a crew of 8.</summary>
    private async Task<(Guid LogId, Guid CrewId)> SaveTalkAsync(string requestId)
    {
        var logId = Guid.NewGuid();
        var crewId = Guid.NewGuid();
        var payload = OldCreatePayload(logId, crewId);
        payload["content"] = RealContent();
        payload["autoSavedFromVoice"] = true;
        await PushAppliedAsync(SpeakerA, "create_daily_log", requestId, payload);
        return (logId, crewId);
    }

    /// <summary>
    /// The server first stored this talk <paramref name="hours"/> ago: its own creation time moved back on this scratch
    /// database. Nothing the phone sends can do this; the window hangs on this column alone.
    /// </summary>
    private Task StoredHoursAgoAsync(Guid logId, int hours) => ExecOnSuperuserAsync(
        "UPDATE ssf.daily_logs SET created_at_utc = created_at_utc - make_interval(hours => @h) WHERE \"Id\" = @id",
        ("h", hours), ("id", logId));

    private async Task<DateTime> CreatedAtAsync(Guid logId) =>
        (DateTime)(await ScalarAsync("SELECT created_at_utc FROM ssf.daily_logs WHERE \"Id\" = @id", logId))!;

    private static object RealContent() => new
    {
        schema = 1,
        capturedAtUtc = DateTime.UtcNow.ToString("O"),
        fullTranscript = "आज इथरेल अडीचशे मिली पाचशे लिटर पाण्यात फवारणी केली. आठ मजूर होते.",
        inputs = new object[]
        {
            new
            {
                id = "tm-input-0", productName = "इथरेल", type = "other", method = "Spray",
                mix = new[] { new { id = "tm-mix-0", productName = "इथरेल", dose = 250, unit = "मिली" } },
                sourceText = "इथरेल अडीचशे मिली पाचशे लिटर पाण्यात फवारणी केली",
            },
        },
    };

    private static object EditedContent() => new
    {
        schema = 1,
        capturedAtUtc = DateTime.UtcNow.ToString("O"),
        inputs = new object[]
        {
            new
            {
                id = "tm-input-0", productName = "इथरेल", type = "other", method = "Spray",
                mix = new[] { new { id = "tm-mix-0", productName = "इथरेल", dose = 300, unit = "मिली" } },
            },
        },
    };

    /// <summary>The create_daily_log keys a 1.0.15–1.0.17 phone sends, with one crew of 8.</summary>
    private static Dictionary<string, object?> OldCreatePayload(Guid dailyLogId, Guid crewId) => new()
    {
        ["dailyLogId"] = dailyLogId,
        ["farmId"] = FarmA,
        ["plotId"] = PlotA,
        ["cropCycleId"] = CycleA,
        ["operatorUserId"] = SpeakerA,
        ["logDate"] = LogDay,
        ["labour"] = new object[] { new { labourAssignmentId = crewId, engagementType = "hired_daily", workerCount = 8 } },
    };

    private static Dictionary<string, object?> RevisePayload(Guid dailyLogId, int baseVersion, object content) => new()
    {
        ["dailyLogId"] = dailyLogId,
        ["baseVersion"] = baseVersion,
        ["content"] = content,
        ["reason"] = "दुरुस्ती",
        ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
    };

    private static Dictionary<string, object?> CountPayload(Guid crewId, Guid logId, int newCount, int seenCount) => new()
    {
        ["labourAssignmentId"] = crewId,
        ["dailyLogId"] = logId,
        ["farmId"] = FarmA,
        ["quantity"] = new Dictionary<string, object?> { ["workerCount"] = newCount },
        ["seen"] = new Dictionary<string, object?> { ["workerCount"] = seenCount },
        ["correctedAtUtc"] = DateTime.UtcNow.ToString("O"),
    };

    private async Task PushAppliedAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var result = await PushAsync(actor, mutationType, clientRequestId, payload);
        result.Status.Should().Be("applied", "{0} error='{1}: {2}'", mutationType, result.ErrorCode, result.ErrorMessage);
    }

    private async Task<SyncMutationResultDto> PushAsync(
        Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var command = new PushSyncBatchCommand(
            DeviceId: $"device-b5-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: actor == OwnerA ? "PrimaryOwner" : "Mukadam",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.0.18");

        var push = await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        return Assert.Single(push.Value!.Results);
    }

    /// <summary>The online count route as the endpoint runs it: the caller's farm scope, then the pipeline-resolved handler.</summary>
    private async Task<Result<CorrectLabourResult>> CorrectOnlineAsync(Guid caller, CorrectLabourCommand command)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.user_id', {caller.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.farm_id', {command.FarmId.Value.ToString()}, true)");
        var result = await sp.GetRequiredService<IHandler<CorrectLabourCommand, CorrectLabourResult>>().HandleAsync(command);
        await tx.CommitAsync();
        return result;
    }

    private async Task<List<DailyLogDto>> PullAllAsync(Guid user)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().SetUserScoped(user);
        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, user));
        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.ToList();
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid user, Guid dailyLogId) =>
        (await PullAllAsync(user)).Should().ContainSingle(l => l.Id == dailyLogId, "the log must come back down").Subject;

    /// <summary>The pulled record as the wire carries it (the API's web JSON), so an absent key is seen as absent.</summary>
    private async Task<JsonElement> PullDailyLogJsonAsync(Guid user, Guid dailyLogId) =>
        JsonSerializer.SerializeToElement(await PullDailyLogAsync(user, dailyLogId), new JsonSerializerOptions(JsonSerializerDefaults.Web));

    private async Task AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText =
            "SELECT current_user, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), current_database()";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        var role = reader.GetString(0);
        var canBypass = reader.GetBoolean(1);
        var database = reader.GetString(2);

        role.Should().Be(AppRoleUser);
        canBypass.Should().BeFalse("an RLS proof run as a superuser or BYPASSRLS role proves nothing (E3)");
        database.Should().Be(_scratchDbName);
        output.WriteLine($"[PROVISIONING] role={role} superuser_or_bypassrls={canBypass} database={database}");
    }

    private async Task ExecOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
    }

    private async Task<int> ScalarIntAsync(string sql, Guid id) => Convert.ToInt32(await ScalarAsync(sql, id));

    private async Task<object?> ScalarAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
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
