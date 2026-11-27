// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract S1; founder 27 Nov: "kinds of work he may record", e.g. only फवारणी and
// पाणी; CTO rulings Q2 = one box औषध / खत, Q3 = A: the server refuses a record holding a forbidden kind and keeps it whole for the owner; S1.7 late
// arrival is in)
//
// On a real Postgres AS THE RESTRICTED APPLICATION ROLE (E3 first), through the real push door, the real REST routes and the real pull: every seat
// reads no limit after the migration and the CHECK refuses an unknown kind; only the registrant sets a seat's kinds (one audit row per real change,
// none for a re-send), never another farm's member; a limited seat is refused a record or a bill holding a kind outside his set - by code AND words,
// nothing written, kept whole for the owner and listed in his kept-work card, 403 with the words on the REST door; a record accepted before the limit
// is still answered as saved; an old record's item may be edited but a new item of a closed kind may not be added; an older phone's task line is
// recognised; work done offline before the owner narrowed his kinds is accepted and marked, and the same work past the window is refused and kept; the
// pull names a limit only for the limited seat, on his own farm.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Finance;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class WorkKindsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string KindCode = "ShramSafal.WorkKind.Forbidden";
    private const string KindWords = "By ShramSafal's rules this kind of work could not be saved for this person. The work is kept on the phone.";

    private static readonly Guid CropLog = Guid.Parse("3d0f0000-0000-4000-8000-000000000001");
    private static readonly Guid WaterLog = Guid.Parse("3d0f0000-0000-4000-8000-000000000002");
    private static readonly Guid OldLog = Guid.Parse("3d0f0000-0000-4000-8000-000000000003");
    private static readonly Guid CrewLog = Guid.Parse("3d0f0000-0000-4000-8000-000000000004");
    private static readonly Guid CrewId = Guid.Parse("3d0f0000-0000-4000-8000-000000000005");
    private static readonly Guid Bill = Guid.Parse("3d0f0000-0000-4000-8000-000000000006");
    private static readonly Guid LateLog = Guid.Parse("3d0f0000-0000-4000-8000-000000000007");
    private static readonly Guid TooLateLog = Guid.Parse("3d0f0000-0000-4000-8000-000000000008");
    private static readonly Guid RestLog = Guid.Parse("3d0f0000-0000-4000-8000-000000000009");

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private Task<HttpResponseMessage> PutKindsAsync(Guid caller, Guid farm, Guid target, string[]? kinds) =>
        SendAsync(HttpMethod.Put, $"/shramsafal/farms/{farm}/memberships/{target}/work-kinds", caller, new { workKinds = kinds });

    private async Task LimitAsync(Guid person, params string[] kinds)
    {
        using var put = await PutKindsAsync(Owner, FarmA, person, kinds);
        put.StatusCode.Should().Be(HttpStatusCode.OK, await put.Content.ReadAsStringAsync());
    }

    private async Task<object?> ScalarAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }

    private async Task<long> CountAsync(string sql, params (string Name, object Value)[] args) => Convert.ToInt64(await ScalarAsync(sql, args));

    private async Task<long> LogsAsync(Guid id) => await CountAsync("SELECT count(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", id));

    private static Dictionary<string, object?> ContentLog(Guid logId, Guid who, object content) => new()
    {
        ["dailyLogId"] = logId,
        ["farmId"] = FarmA,
        ["plotId"] = PlotA,
        ["cropCycleId"] = CycleA,
        ["operatorUserId"] = who,
        ["logDate"] = WorkDay,
        ["content"] = content,
    };

    private static object CropContent(string id = "c-1", string? capturedAtUtc = null) => capturedAtUtc is null
        ? new { schema = 1, cropActivities = new object[] { new { id, title = "खुरपणी" } } }
        : new { schema = 1, capturedAtUtc, cropActivities = new object[] { new { id, title = "खुरपणी" } } };

    private static object WaterContent() => new { schema = 1, irrigation = new object[] { new { id = "w-1", method = "drip" } }, observations = new object[] { new { id = "o-1", textRaw = "पानं पिवळी" } } };

    [Fact]
    public async Task Every_existing_seat_reads_no_limit_after_the_migration()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await CountAsync("SELECT count(*) FROM ssf.farm_memberships")).Should().BeGreaterThan(5);
        (await CountAsync("SELECT count(*) FROM ssf.farm_memberships WHERE allowed_work_kinds IS NOT NULL OR work_kinds_changed_at_utc IS NOT NULL")).Should().Be(0);

        // Nothing changes for any seat: every kind is still recorded, and no pull names a limit.
        await PushAppliedAsync(Worker, "create_daily_log", "perm-wk-no-limit", ContentLog(CropLog, Worker, CropContent()));
        foreach (var reader in new[] { Owner, CoOwner, Mukadam, Worker })
        {
            (await PullAsync(reader)).Body.Should().NotContain("\"workKinds\"");
        }
    }

    [Fact]
    public async Task A_raw_write_of_an_unknown_kind_fails_the_check()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var bad in new[] { "ARRAY['spray']::text[]", "ARRAY[]::text[]", "ARRAY['irrigation','observations']::text[]" })
        {
            var write = async () => await ExecOnSuperuserAsync(
                $"UPDATE ssf.farm_memberships SET allowed_work_kinds = {bad} WHERE farm_id = @f AND user_id = @u", ("f", FarmA), ("u", Worker));
            (await write.Should().ThrowAsync<PostgresException>()).Which.ConstraintName.Should().Be("ck_farm_memberships_work_kinds", bad);
        }

        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET allowed_work_kinds = ARRAY['irrigation','inputs']::text[] WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", Worker));
    }

    [Fact]
    public async Task Only_the_registrant_sets_work_kinds_and_a_resend_writes_no_audit_row()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Not the सहमालक or the मुकादम (403); never the registrant's own row or his own seat (403, the membership guards).
        foreach (var caller in new[] { CoOwner, Mukadam })
        {
            using var notHis = await PutKindsAsync(caller, FarmA, Worker, ["irrigation"]);
            notHis.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        using (var own = await PutKindsAsync(Owner, FarmA, Owner, ["irrigation"]))
        {
            own.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        // A bad body is refused by name (400): an empty set, an unknown, always-open or repeated name, no list at all.
        foreach (var bad in new[] { Array.Empty<string>(), ["spray"], ["observations"], ["irrigation", "irrigation"], null })
        {
            using var refused = await PutKindsAsync(Owner, FarmA, Worker, bad);
            refused.StatusCode.Should().Be(HttpStatusCode.BadRequest, JsonSerializer.Serialize(bad));
            (await refused.Content.ReadAsStringAsync()).Should().Contain("ShramSafal.InvalidCommand");
        }

        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'MemberWorkKindsChanged'")).Should().Be(0);

        // The registrant limits the कामगार to पाणी and औषध / खत: the row as the server holds it, one audit row (from, to); a re-send writes nothing.
        using (var put = await PutKindsAsync(Owner, FarmA, Worker, ["inputs", "irrigation"]))
        {
            put.StatusCode.Should().Be(HttpStatusCode.OK);
            using var row = JsonDocument.Parse(await put.Content.ReadAsStringAsync());
            row.RootElement.GetProperty("workKinds").EnumerateArray().Select(e => e.GetString()).Should().Equal("irrigation", "inputs");
        }

        await LimitAsync(Worker, "irrigation", "inputs");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'MemberWorkKindsChanged'")).Should().Be(1);
        var payload = ((string)(await ScalarAsync("SELECT payload::text FROM ssf.audit_events WHERE action = 'MemberWorkKindsChanged'"))!).Replace(" ", string.Empty);
        payload.Should().Contain("\"workKindsBefore\":null").And.Contain("\"workKinds\":[\"irrigation\",\"inputs\"]");
        Convert.ToString(await ScalarAsync("SELECT actor_user_id FROM ssf.audit_events WHERE action = 'MemberWorkKindsChanged'")).Should().Be(Owner.ToString());

        // The roster shows it; ticking all six stores no limit (the key is left out again) and is a second real change.
        await LimitAsync(Worker, "cropActivities", "irrigation", "inputs", "labour", "machinery", "activityExpenses");
        (await ScalarAsync("SELECT allowed_work_kinds FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u", ("f", FarmA), ("u", Worker)))
            .Should().Be(DBNull.Value);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'MemberWorkKindsChanged'")).Should().Be(2);
    }

    [Fact]
    public async Task A_put_naming_another_farms_member_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Farm A's registrant names farm B's owner on farm A (no seat there), and farm B's owner names farm A's कामगार: both refused, nothing stored.
        using (var noSeat = await PutKindsAsync(Owner, FarmA, OwnerB, ["irrigation"]))
        {
            noSeat.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        using (var otherFarm = await PutKindsAsync(OwnerB, FarmA, Worker, ["irrigation"]))
        {
            otherFarm.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        using (var wrongFarm = await PutKindsAsync(OwnerB, FarmB, Worker, ["irrigation"]))
        {
            wrongFarm.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        (await CountAsync("SELECT count(*) FROM ssf.farm_memberships WHERE allowed_work_kinds IS NOT NULL")).Should().Be(0);
    }

    [Fact]
    public async Task A_seat_limited_to_water_and_sprays_is_refused_crop_work_by_name_and_nothing_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await LimitAsync(Worker, "irrigation", "inputs");

        // His पाणी record with an observation goes through: observations are always open.
        await PushAppliedAsync(Worker, "create_daily_log", "perm-wk-water", ContentLog(WaterLog, Worker, WaterContent()));

        // His खुरपणी record is refused by code AND words, and nothing of it is written.
        var refused = await PushAsync(Worker, "create_daily_log", "perm-wk-crop", ContentLog(CropLog, Worker, CropContent()));
        refused.Status.Should().NotBe("applied");
        refused.ErrorCode.Should().Be(KindCode);
        refused.ErrorMessage.Should().Be(KindWords);
        (await LogsAsync(CropLog)).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_id = @id", ("id", CropLog))).Should().Be(0);

        // A record with only labour (the हजेरी door) is labour, and labour is closed to him.
        var crew = LogPayload(CrewLog, Worker, CrewId, 3, null, null, [], null);
        crew["captureScope"] = "labour";
        (await PushAsync(Worker, "create_daily_log", "perm-wk-labour-door", crew)).ErrorCode.Should().Be(KindCode);

        // An older phone's manual save (its draft) is read the same way.
        var draft = ContentLog(OldLog, Worker, new { schema = 1 });
        draft.Remove("content");
        draft["manualDraft"] = new { machinery = new object[] { new { id = "m-1", type = "tractor" } } };
        (await PushAsync(Worker, "create_daily_log", "perm-wk-draft", draft)).ErrorCode.Should().Be(KindCode);

        // Another seat on the farm is not limited by his set.
        await PushAppliedAsync(Mukadam, "create_daily_log", "perm-wk-mukadam-crop", ContentLog(OldLog, Mukadam, CropContent()));
    }

    [Fact]
    public async Task A_replay_of_a_record_accepted_before_the_limit_is_answered_as_saved()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var first = await PushAppliedAsync(Worker, "create_daily_log", "perm-wk-before", ContentLog(CropLog, Worker, CropContent()));
        await LimitAsync(Worker, "irrigation");

        // The phone did not see the answer and sends the same record again: answered as saved, nothing new.
        var again = await PushAsync(Worker, "create_daily_log", "perm-wk-before", ContentLog(CropLog, Worker, CropContent()));
        again.Status.Should().NotBe("rejected");
        again.ErrorCode.Should().BeNull();
        (await LogsAsync(CropLog)).Should().Be(1);
        first.Status.Should().Be("applied");
    }

    [Fact]
    public async Task Editing_an_existing_crop_item_of_an_old_record_is_allowed_but_adding_one_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Worker, "create_daily_log", "perm-wk-old", ContentLog(OldLog, Worker, CropContent("c-1")));
        await LimitAsync(Worker, "irrigation");

        Dictionary<string, object?> Revise(int baseVersion, object content) => new()
        {
            ["dailyLogId"] = OldLog,
            ["baseVersion"] = baseVersion,
            ["content"] = content,
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        };

        // The old item, said better: allowed (old records keep what they hold).
        await PushAppliedAsync(Worker, "revise_log_content", "perm-wk-edit-old",
            Revise(1, new { schema = 1, cropActivities = new object[] { new { id = "c-1", title = "खुरपणी आणि बांधणी" } } }));

        // A new crop item on the same old record: refused by code and words; the record stays as it was.
        var added = await PushAsync(Worker, "revise_log_content", "perm-wk-add-new",
            Revise(2, new { schema = 1, cropActivities = new object[] { new { id = "c-1", title = "खुरपणी आणि बांधणी" }, new { id = "c-2", title = "छाटणी" } } }));
        added.ErrorCode.Should().Be(KindCode);
        added.ErrorMessage.Should().Be(KindWords);
        (await CountAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", OldLog))).Should().Be(2);

        // A new item of a kind he may record is fine.
        await PushAppliedAsync(Worker, "revise_log_content", "perm-wk-add-water",
            Revise(2, new { schema = 1, cropActivities = new object[] { new { id = "c-1", title = "खुरपणी आणि बांधणी" } }, irrigation = new object[] { new { id = "w-9", method = "flood" } } }));
    }

    [Fact]
    public async Task Line_money_of_an_allowed_labour_line_is_accepted_while_expense_is_not()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await LimitAsync(Worker, "labour");

        await PushAppliedAsync(Worker, "create_daily_log", "perm-wk-crew", LogPayload(CrewLog, Worker, CrewId, 4, null, 1200m, [], null));
        var lineMoney = CostPayload(MoneyEntryIdentity.ForRecordLine(CrewLog, MoneyEntryIdentity.Labour, CrewId.ToString("D")), FarmA, PlotA, CycleA, 1200m);
        lineMoney["categoryId"] = "labour_misc";
        await PushAppliedAsync(Worker, "add_cost_entry", "perm-wk-crew-money", lineMoney);

        // A standalone bill (a खर्च) is refused when खर्च is not his.
        var bill = await PushAsync(Worker, "add_cost_entry", "perm-wk-bill", CostPayload(Bill, FarmA, PlotA, CycleA, 640m));
        bill.ErrorCode.Should().Be(KindCode);
        bill.ErrorMessage.Should().Be(KindWords);
        (await CountAsync("SELECT count(*) FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", Bill))).Should().Be(0);
    }

    [Fact]
    public async Task An_older_phones_task_line_is_recognised_and_observations_stay_open()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Worker, "create_daily_log", "perm-wk-task-log", ContentLog(WaterLog, Worker, WaterContent()));
        await LimitAsync(Worker, "irrigation");

        Dictionary<string, object?> Task(string activity) => new()
        {
            ["logTaskId"] = Guid.NewGuid(),
            ["dailyLogId"] = WaterLog,
            ["activityType"] = activity,
            ["occurredAtUtc"] = DateTime.UtcNow.ToString("O"),
        };

        await PushAppliedAsync(Worker, "add_log_task", "perm-wk-task-water", Task("पाणी दिले"));
        await PushAppliedAsync(Worker, "add_log_task", "perm-wk-task-observation", Task("observation"));
        var spray = await PushAsync(Worker, "add_log_task", "perm-wk-task-spray", Task("फवारणी"));
        spray.ErrorCode.Should().Be(KindCode);
        spray.ErrorMessage.Should().Be(KindWords);
    }

    [Fact]
    public async Task A_refused_kind_is_kept_whole_and_listed_in_kept_work()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await LimitAsync(Worker, "irrigation");
        (await PushAsync(Worker, "create_daily_log", "perm-wk-kept", ContentLog(CropLog, Worker, CropContent()))).ErrorCode.Should().Be(KindCode);

        // Kept whole for the owner (P10): the mutation exactly as it arrived.
        var kept = (string)(await ScalarAsync(
            "SELECT payload::text FROM ssf.audit_events WHERE action = 'WorkKeptForOwner' AND farm_id = @f", ("f", FarmA)))!;
        kept.Should().Contain(CropLog.ToString()).And.Contain(KindCode);
        using (var keptDoc = JsonDocument.Parse(kept))
        {
            keptDoc.RootElement.GetProperty("mutation").GetProperty("content").GetProperty("cropActivities")[0]
                .GetProperty("title").GetString().Should().Be("खुरपणी", "the work is kept exactly as it arrived");
        }

        using var list = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/kept-work", Owner);
        var text = await list.Content.ReadAsStringAsync();
        list.StatusCode.Should().Be(HttpStatusCode.OK, text);
        var item = JsonDocument.Parse(text).RootElement.EnumerateArray().Single();
        item.GetProperty("kind").GetString().Should().Be("refused");
        item.GetProperty("what").GetString().Should().Be("create_daily_log");
        item.GetProperty("why").GetString().Should().Be(KindCode);

        // The REST door answers 403 with the same code and words.
        using var rest = await SendAsync(HttpMethod.Post, "/shramsafal/logs", Worker, new
        {
            farmId = FarmA,
            plotId = PlotA,
            cropCycleId = CycleA,
            logDate = WorkDay,
            clientRequestId = "perm-wk-rest",
            labour = new object[] { new { labourAssignmentId = Guid.NewGuid(), engagementType = "hired_daily", workerCount = 2 } },
        });
        var restText = await rest.Content.ReadAsStringAsync();
        rest.StatusCode.Should().Be(HttpStatusCode.Forbidden, restText);
        restText.Should().Contain(KindCode).And.Contain(KindWords);
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs WHERE operator_user_id = @u AND \"Id\" <> @w", ("u", Worker), ("w", WorkerLog))).Should().Be(0);
        _ = RestLog;
    }

    [Fact]
    public async Task Work_recorded_before_the_owner_narrowed_his_kinds_is_accepted_and_marked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await LimitAsync(Worker, "irrigation");

        // His phone captured crop work two days before the owner's change, offline; it arrives now (inside 7 + 7 days): accepted, and flagged.
        var captured = DateTime.UtcNow.AddDays(-2).ToString("O");
        await PushAppliedAsync(Worker, "create_daily_log", "perm-wk-late", ContentLog(LateLog, Worker, CropContent(capturedAtUtc: captured)));
        (await LogsAsync(LateLog)).Should().Be(1);
        var mark = (string)(await ScalarAsync(
            "SELECT payload::text FROM ssf.audit_events WHERE action = 'AcceptedAfterResponsibilityEnded' AND entity_id = @id", ("id", LateLog)))!;
        mark.Replace(" ", string.Empty).Should().Contain("\"authority\":\"WorkKinds\"").And.Contain("\"kinds\":[\"cropActivities\"]");

        using var list = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/kept-work", Owner);
        var item = JsonDocument.Parse(await list.Content.ReadAsStringAsync()).RootElement.EnumerateArray().Single();
        item.GetProperty("kind").GetString().Should().Be("arrived_late");
        item.GetProperty("why").GetString().Should().Be("WorkKinds");

        // Work he captured AFTER the change is not late work: refused.
        var after = await PushAsync(Worker, "create_daily_log", "perm-wk-after", ContentLog(TooLateLog, Worker, CropContent(capturedAtUtc: DateTime.UtcNow.ToString("O"))));
        after.ErrorCode.Should().Be(KindCode);
    }

    [Fact]
    public async Task The_same_work_eight_days_later_is_refused_and_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await LimitAsync(Worker, "irrigation");

        // The owner's change was 8 days ago: work captured the day before it arrives past the 7-day window.
        await ExecOnSuperuserAsync("""
            UPDATE ssf.farm_memberships SET work_kinds_changed_at_utc = NOW() - INTERVAL '8 days' WHERE farm_id = @f AND user_id = @u;
            UPDATE ssf.audit_events SET occurred_at_utc = NOW() - INTERVAL '8 days' WHERE action = 'MemberWorkKindsChanged';
            """, ("f", FarmA), ("u", Worker));
        var captured = DateTime.UtcNow.AddDays(-9).ToString("O");
        var refused = await PushAsync(Worker, "create_daily_log", "perm-wk-too-late", ContentLog(TooLateLog, Worker, CropContent(capturedAtUtc: captured)));
        refused.ErrorCode.Should().Be(KindCode);
        refused.ErrorMessage.Should().Be(KindWords);
        (await LogsAsync(TooLateLog)).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'WorkKeptForOwner' AND farm_id = @f", ("f", FarmA))).Should().Be(1);

        // Work captured more than 7 days BEFORE the change is refused too (no window).
        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET work_kinds_changed_at_utc = NOW() WHERE farm_id = @f AND user_id = @u", ("f", FarmA), ("u", Worker));
        var old = await PushAsync(Worker, "create_daily_log", "perm-wk-too-old", ContentLog(LateLog, Worker, CropContent(capturedAtUtc: DateTime.UtcNow.AddDays(-8).ToString("O"))));
        old.ErrorCode.Should().Be(KindCode);
    }

    [Fact]
    public async Task A_pull_for_an_unlimited_seat_has_no_workKinds_key()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await LimitAsync(Worker, "inputs", "irrigation");

        var (_, workerRoot) = await PullAsync(Worker);
        var scope = workerRoot.GetProperty("accessScopes").EnumerateArray().Single(s => s.GetProperty("farmId").GetGuid() == FarmA);
        scope.GetProperty("workKinds").EnumerateArray().Select(e => e.GetString()).Should().Equal("irrigation", "inputs");

        foreach (var reader in new[] { Owner, CoOwner, Mukadam, Worker2, OwnerB })
        {
            (await PullAsync(reader)).Body.Should().NotContain("\"workKinds\"", $"{reader}'s seat records every kind");
        }

        // The roster row the owner's team card reads says it too.
        using var roster = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/labour-permissions", Owner);
        var rosterText = await roster.Content.ReadAsStringAsync();
        roster.StatusCode.Should().Be(HttpStatusCode.OK, rosterText);
        var row = JsonDocument.Parse(rosterText).RootElement.EnumerateArray().Single(r => r.GetProperty("userId").GetGuid() == Worker);
        row.GetProperty("workKinds").EnumerateArray().Select(e => e.GetString()).Should().Equal("irrigation", "inputs");
        JsonDocument.Parse(rosterText).RootElement.EnumerateArray().Single(r => r.GetProperty("userId").GetGuid() == Mukadam)
            .TryGetProperty("workKinds", out _).Should().BeFalse("every kind is no key");
        _ = Web;
    }
}
