// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 Task 1 ("का केलं": a reason kept on the existing record; founder D-68 round 2; D-66 / D-69;
// R12; E4; P1, P3, P4).
//
// `logreason.set` { reasonId, farmId, dailyLogId, workKey, kind, words?, saidByVoice } through the real push door, and the reason served inside the farm
// compare read's `ownWork[].reason`. Who may set one: whoever may open तुलना (the primary owner or a seat that holds "तुलना पाहणे") AND may see that record.
// The authority is asked FIRST (a seat without it gets one answer for a real record, a made-up one and another farm's); a record kept from him answers like
// one that does not exist. A reason never changes the record. Append-only: a later reason supersedes, both stay. Erasing the author removes his words, the
// kind stays.
//
// Real Postgres as agrisync_app through the real host (E3 first, in every fact). Fake phone numbers only. Every negative asserts that NOTHING leaked and
// NOTHING was written.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class LogPracticeReasonRealPostgresTests(ITestOutputHelper output) : FarmCompareLane(output)
{
    private const string MigrationId = "20261113120000_AddLogPracticeReasons";
    private const string MigrationBefore = "20261113090000_AddScheduleStepMoves";
    private const string OwnWork = "वेली बांधणी";
    private const string SecretWords = "गुप्त-कारण-७७";
    private const string MoneyNote = "रवीला ५०० रु.";

    // ---- helpers ------------------------------------------------------------------------------------------------

    private static DateOnly DayOf(int dayToday, int day) => TodayIst().AddDays(-dayToday + day);

    /// <summary>A plot on its day 20 following the checked University schedule; its own work "वेली बांधणी" is in no schedule.</summary>
    private async Task<(Guid Plot, Guid Cycle)> PlotAsync(int dayToday = 20)
    {
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle, _) = await FollowingAsync(uni.Id, dayToday);
        return (plot, cycle);
    }

    /// <summary>A record of his own work (listed in तुलना as own work) and its work key as the compare read shows it.</summary>
    private async Task<(Guid Log, string Key)> OwnWorkRecordAsync(
        Guid plot, Guid cycle, Guid? actor = null, string? notes = null, bool hide = false, int day = 19)
    {
        var log = await RecordAsync(actor ?? Owner, plot, cycle, DayOf(20, day), OwnWork, notes: notes);
        var item = PlotOf(await CompareOkAsync(Owner, FarmA), plot).GetProperty("ownWork").EnumerateArray()
            .Single(o => o.GetProperty("dailyLogId").GetGuid() == log);
        var key = item.GetProperty("workKey").GetString()!;
        if (hide)
        {
            await HideAsync(log);
        }

        return (log, key);
    }

    private Task<SyncMutationResultDto> SetAsync(
        Guid actor, Guid log, string key, string kind = "Weather", string? words = null, bool voice = false,
        Guid? reasonId = null, Guid? farm = null, string? requestId = null)
    {
        var id = reasonId ?? Guid.NewGuid();
        var payload = new Dictionary<string, object?>
        {
            ["reasonId"] = id,
            ["farmId"] = farm ?? FarmA,
            ["dailyLogId"] = log,
            ["workKey"] = key,
            ["kind"] = kind,
            ["saidByVoice"] = voice,
        };
        if (words is not null)
        {
            payload["words"] = words;
        }

        return PushAsAsync(actor, "logreason.set", requestId ?? $"cmpd3-reason-{id:N}", payload, "1.0.18");
    }

    private async Task<SyncMutationResultDto> SetOkAsync(
        Guid actor, Guid log, string key, string kind = "Weather", string? words = null, bool voice = false, Guid? reasonId = null)
    {
        var result = await SetAsync(actor, log, key, kind, words, voice, reasonId);
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    private Task<long> RowsAsync() => CountAsync("SELECT count(*) FROM ssf.log_practice_reasons");

    private sealed record ReasonRow(Guid Id, Guid Log, string Key, string Kind, string? Words, bool Voice, Guid Author, Guid? Supersedes);

    private async Task<List<ReasonRow>> ReasonRowsAsync()
    {
        var rows = new List<ReasonRow>();
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT "Id", daily_log_id, work_key, kind, words, said_by_voice, author_user_id, supersedes_id
            FROM ssf.log_practice_reasons ORDER BY created_at_utc, "Id"
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new ReasonRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetBoolean(5), reader.GetGuid(6),
                reader.IsDBNull(7) ? null : reader.GetGuid(7)));
        }

        return rows;
    }

    private async Task<string> FingerprintAsync(Guid log)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT md5(
               coalesce((SELECT row_to_json(l)::text FROM ssf.daily_logs l WHERE l."Id" = @l), '') || '#' ||
               coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY t."Id") FROM ssf.log_tasks t WHERE t.daily_log_id = @l), '') || '#' ||
               coalesce((SELECT string_agg(row_to_json(c)::text, '|' ORDER BY c.content_version) FROM ssf.daily_log_contents c WHERE c.daily_log_id = @l), '') || '#' ||
               coalesce((SELECT string_agg(row_to_json(v)::text, '|' ORDER BY v."Id") FROM ssf.verification_events v WHERE v.daily_log_id = @l), ''))
            """;
        cmd.Parameters.AddWithValue("l", log);
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    private static JsonElement OwnWorkOf(JsonElement root, Guid plot, Guid log) =>
        PlotOf(root, plot).GetProperty("ownWork").EnumerateArray().Single(o => o.GetProperty("dailyLogId").GetGuid() == log);

    private static string Shape(SyncMutationResultDto r) => $"{r.Status}|{r.ErrorCode}|{r.ErrorMessage}";

    private Task ReasonAuthoritiesAsync(Guid user, params FarmAuthority[] authorities) => SetAuthoritiesAsync(FarmA, user, authorities);

    // ---- arrives once, supersedes, shows ------------------------------------------------------------------------

    [Fact]
    public async Task A_reason_saved_offline_arrives_once_and_a_replay_writes_nothing_new()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        var id = Guid.NewGuid();
        await SetOkAsync(Owner, log, key, "Weather", "पाऊस आला म्हणून वेगळं केलं", voice: true, reasonId: id);
        var first = await ReasonRowsAsync();
        first.Should().ContainSingle();
        first[0].Should().Be(new ReasonRow(id, log, key, "Weather", "पाऊस आला म्हणून वेगळं केलं", true, Owner, null));

        // the phone sends the same request again (no answer reached it): the ledger answers, nothing new is written
        (await SetAsync(Owner, log, key, "Weather", "पाऊस आला म्हणून वेगळं केलं", true, reasonId: id)).Status.Should().Be("duplicate", "the push ledger answers a repeated request");
        // the same reason id under a NEW request id (a retry that lost its request id): the handler answers the row it made
        (await SetAsync(Owner, log, key, "Weather", "पाऊस आला म्हणून वेगळं केलं", true, reasonId: id, requestId: $"again-{Guid.NewGuid():N}"))
            .Status.Should().Be("applied");
        (await RowsAsync()).Should().Be(1, "a reason saved offline arrives once, however often it is sent");
    }

    [Fact]
    public async Task A_second_reason_supersedes_the_first_and_both_stay_in_history()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        await SetOkAsync(Owner, log, key, "Practice", "माझी पद्धत", reasonId: firstId);
        await SetOkAsync(Owner, log, key, "Weather", "पाऊस होता", reasonId: secondId);

        var rows = await ReasonRowsAsync();
        rows.Select(r => r.Id).Should().Equal(new[] { firstId, secondId }, "both stay: history is kept (P3)");
        rows[0].Supersedes.Should().BeNull();
        rows[1].Supersedes.Should().Be(firstId, "the later one names the one it replaces");
        rows[0].Kind.Should().Be("Practice");
        rows[0].Words.Should().Be("माझी पद्धत", "the first row is never edited");

        var reason = OwnWorkOf(await CompareOkAsync(Owner, FarmA), plot, log).GetProperty("reason");
        reason.GetProperty("kind").GetString().Should().Be("Weather", "the latest one is shown");
        reason.GetProperty("words").GetString().Should().Be("पाऊस होता");
    }

    [Fact]
    public async Task The_reason_appears_in_the_compare_read_for_a_reader_who_may_see_the_log_with_kind_words_and_voice_and_nothing_else()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        var (other, _) = await OwnWorkRecordAsync(plot, cycle, day: 18);
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare);

        (OwnWorkOf(await CompareOkAsync(CoOwner, FarmA), plot, log).GetProperty("reason").ValueKind)
            .Should().Be(JsonValueKind.Null, "the precondition: no reason yet (CMP-D2's null)");

        await SetOkAsync(Owner, log, key, "Extra", "जास्त तण होतं", voice: true);

        var co = await CompareOkAsync(CoOwner, FarmA);
        var reason = OwnWorkOf(co, plot, log).GetProperty("reason");
        reason.GetProperty("kind").GetString().Should().Be("Extra");
        reason.GetProperty("words").GetString().Should().Be("जास्त तण होतं");
        reason.GetProperty("saidByVoice").GetBoolean().Should().BeTrue();
        NamesIn(reason).Should().Equal(new[] { "kind", "saidByVoice", "words" }, "a reason is its kind, its words and whether they were spoken - no id, no author, no time");
        OwnWorkOf(co, plot, other).GetProperty("reason").ValueKind.Should().Be(JsonValueKind.Null, "another record of the same work has none");

        // the owner reads the same one
        OwnWorkOf(await CompareOkAsync(Owner, FarmA), plot, log).GetProperty("reason").GetProperty("kind").GetString().Should().Be("Extra");
    }

    [Fact]
    public async Task A_reason_with_only_the_picture_has_no_words_and_is_not_said_by_voice()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        await SetOkAsync(Owner, log, key, "Practice", words: null, voice: true); // the flag follows the words: nothing was said
        var row = (await ReasonRowsAsync()).Single();
        row.Words.Should().BeNull();
        row.Voice.Should().BeFalse();

        var reason = OwnWorkOf(await CompareOkAsync(Owner, FarmA), plot, log).GetProperty("reason");
        reason.GetProperty("kind").GetString().Should().Be("Practice");
        reason.GetProperty("words").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task A_reason_never_alters_the_log_its_version_confirmation_or_verification()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle, notes: "बांधणी केली");
        var before = await FingerprintAsync(log);
        var versionBefore = await CountAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @l", ("l", log));
        var modifiedBefore = await CountAsync("SELECT (extract(epoch FROM modified_at_utc) * 1000000)::bigint FROM ssf.daily_logs WHERE \"Id\" = @l", ("l", log));

        await SetOkAsync(Owner, log, key, "Weather", "पाऊस");
        await SetOkAsync(Owner, log, key, "Extra", "जास्त काम");
        (await RowsAsync()).Should().Be(2, "the precondition: the reasons are written");

        (await FingerprintAsync(log)).Should().Be(before, "the log's row, tasks, content versions and confirmations are byte-equal before and after");
        (await CountAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @l", ("l", log))).Should().Be(versionBefore);
        (await CountAsync("SELECT (extract(epoch FROM modified_at_utc) * 1000000)::bigint FROM ssf.daily_logs WHERE \"Id\" = @l", ("l", log)))
            .Should().Be(modifiedBefore, "the pull cursor of the record does not move: nothing re-sends it");
    }

    // ---- who may set --------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_worker_is_refused_and_nothing_is_written_or_leaked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        await SetOkAsync(Owner, log, key); // not vacuous: the owner may
        var rowsBefore = await RowsAsync();
        var refused = await SetAsync(Worker, log, key, words: SecretWords);
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (refused.ErrorMessage ?? "").Should().NotContain(SecretWords).And.NotContain(log.ToString());
        (await RowsAsync()).Should().Be(rowsBefore, "nothing was written");

        // Even a Worker whose stored row carries the bit (a hand-written row, an old build) holds nothing (CanBeHeldBy).
        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET permissions = 4096 WHERE farm_id = @f AND user_id = @u", ("f", FarmA), ("u", Worker));
        (await SetAsync(Worker, log, key)).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await RowsAsync()).Should().Be(rowsBefore);
    }

    [Fact]
    public async Task A_mukadam_and_a_co_owner_without_SeeCompare_are_refused_and_with_it_may_set()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        foreach (var seat in new[] { Mukadam, CoOwner })
        {
            var without = await SetAsync(seat, log, key, words: SecretWords);
            without.Status.Should().Be("failed");
            without.ErrorCode.Should().Be("ShramSafal.Forbidden", "a seat without तुलना पाहणे holds nothing here");
            (await RowsAsync()).Should().Be(0, "nothing was written");
        }

        await ReasonAuthoritiesAsync(Mukadam, FarmAuthority.SeeCompare);
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare);
        var m = await SetOkAsync(Mukadam, log, key, "Practice", "माझी पद्धत");
        await SetOkAsync(CoOwner, log, key, "Weather", "पाऊस");
        (await RowsAsync()).Should().Be(2);
        (await ReasonRowsAsync()).Select(r => r.Author).Should().Equal(new[] { Mukadam, CoOwner }, "the author is the authenticated sender, never a payload field");
        m.Status.Should().Be("applied");
    }

    [Fact]
    public async Task A_paused_a_waiting_and_a_removed_seat_are_refused_like_a_worker_and_the_rows_do_not_change()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        await SetOkAsync(Owner, log, key); // one row to compare against
        var rowsBefore = await ReasonRowsAsync();

        var worker = await SetAsync(Worker, log, key, words: SecretWords);
        foreach (var (status, name) in new[] { (4, "paused"), (2, "waiting"), (5, "removed") })
        {
            await ExecOnSuperuserAsync(
                "UPDATE ssf.farm_memberships SET status = @s, permissions = 4096 WHERE farm_id = @f AND user_id = @u",
                ("s", status), ("f", FarmA), ("u", Mukadam));
            var refused = await SetAsync(Mukadam, log, key, words: SecretWords);
            refused.Status.Should().Be("failed", name);
            refused.ErrorCode.Should().Be(worker.ErrorCode, $"a {name} seat holding the bit is refused like a worker (ShramSafal.Forbidden)");
            (refused.ErrorMessage ?? "").Should().NotContain(SecretWords);
            (await ReasonRowsAsync()).Should().BeEquivalentTo(rowsBefore, $"{name}: the rows are unchanged");
        }
    }

    [Fact]
    public async Task A_chosen_plots_seat_may_set_on_his_plot_and_is_refused_on_another_plots_record_like_a_record_that_does_not_exist()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var uni = await CheckedInstitutionAsync();
        var (mine, mineCycle, _) = await FollowingAsync(uni.Id, 20);
        var (other, otherCycle, _) = await FollowingAsync(uni.Id, 20);
        var (myLog, myKey) = await OwnWorkRecordAsync(mine, mineCycle);
        var (otherLog, otherKey) = await OwnWorkRecordAsync(other, otherCycle);
        await ReasonAuthoritiesAsync(Mukadam, FarmAuthority.SeeCompare);
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { mine } }))
        {
            set.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await SetAsync(Mukadam, myLog, myKey, words: "माझ्या प्लॉटवर")).Status.Should().Be("applied", "his own plot");

        var outside = await SetAsync(Mukadam, otherLog, otherKey, words: SecretWords);
        var madeUp = await SetAsync(Mukadam, Guid.NewGuid(), otherKey, words: SecretWords);
        outside.Status.Should().Be("failed");
        Shape(outside).Should().Be(Shape(madeUp), "a record outside his plots answers like one that does not exist");
        (await RowsAsync()).Should().Be(1, "only his own plot's reason was written");

        // and the reason on the other plot (set by the owner) is never served to him
        await SetOkAsync(Owner, otherLog, otherKey, "Weather", SecretWords);
        var (status, body) = await CompareAsync(Mukadam, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        body.Should().NotContain(SecretWords).And.NotContain(otherLog.ToString()).And.NotContain(other.ToString());
    }

    [Fact]
    public async Task A_seat_limited_to_his_own_records_may_set_only_on_his_own_record()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (ownersLog, ownersKey) = await OwnWorkRecordAsync(plot, cycle);
        await ReasonAuthoritiesAsync(Mukadam, FarmAuthority.SeeCompare);
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "OwnWork", plotIds = (Guid[]?)null }))
        {
            set.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var (hisLog, hisKey) = await OwnWorkRecordAsync(plot, cycle, actor: Mukadam, day: 18);
        var refused = await SetAsync(Mukadam, ownersLog, ownersKey, words: SecretWords);
        Shape(refused).Should().Be(Shape(await SetAsync(Mukadam, Guid.NewGuid(), ownersKey, words: SecretWords)),
            "the owner's record is not his to see: it answers like one that does not exist");
        (await RowsAsync()).Should().Be(0);
        (await SetAsync(Mukadam, hisLog, hisKey, words: "माझं काम")).Status.Should().Be("applied");
        (await RowsAsync()).Should().Be(1);
    }

    [Fact]
    public async Task A_seat_without_the_authority_gets_one_answer_for_a_real_a_made_up_and_another_farms_log()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        foreach (var seat in new[] { CoOwner, Mukadam, Worker })
        {
            var real = await SetAsync(seat, log, key);
            var madeUp = await SetAsync(seat, Guid.NewGuid(), key);
            var farmB = await SetAsync(seat, FarmBLog, key);
            real.Status.Should().Be("failed");
            Shape(madeUp).Should().Be(Shape(real), "E4: authority is asked before the record is read, so no log is an oracle");
            Shape(farmB).Should().Be(Shape(real));
            real.ErrorCode.Should().Be("ShramSafal.Forbidden");
        }

        (await RowsAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Another_farms_holder_and_a_made_up_log_id_get_identical_status_and_body()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        // Farm B's primary owner passes the rule on HIS farm and on no other.
        // (a) naming farm A: he is no member of it - the same answer for a real log and a made-up one
        var stranger = await SetAsync(OwnerB, log, key, words: SecretWords);
        var strangerMadeUp = await SetAsync(OwnerB, Guid.NewGuid(), key, words: SecretWords);
        stranger.Status.Should().Be("failed");
        Shape(stranger).Should().Be(Shape(strangerMadeUp));
        (stranger.ErrorMessage ?? "").Should().NotContain(log.ToString()).And.NotContain(SecretWords);

        // (b) naming HIS farm with farm A's log: under his own farm's scope that log does not exist - the same answer as a made-up id
        var crossed = await SetAsync(OwnerB, log, key, words: SecretWords, farm: FarmB);
        var crossedMadeUp = await SetAsync(OwnerB, Guid.NewGuid(), key, words: SecretWords, farm: FarmB);
        crossed.Status.Should().Be("failed");
        crossed.ErrorCode.Should().Be("ShramSafal.DailyLogNotFound");
        Shape(crossed).Should().Be(Shape(crossedMadeUp), "another farm's log answers like a made-up one");

        // (c) farm A's holder naming his farm with farm B's log
        var other = await SetAsync(Owner, FarmBLog, key, words: SecretWords);
        var otherMadeUp = await SetAsync(Owner, Guid.NewGuid(), key, words: SecretWords);
        Shape(other).Should().Be(Shape(otherMadeUp));
        (await RowsAsync()).Should().Be(0, "nothing was written anywhere");
    }

    [Fact]
    public async Task A_record_kept_from_him_answers_like_a_record_that_does_not_exist_and_its_reason_is_never_served()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (hidden, hiddenKey) = await OwnWorkRecordAsync(plot, cycle, hide: true);
        var (shown, shownKey) = await OwnWorkRecordAsync(plot, cycle, day: 18);
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare);

        // not vacuous: the co-owner may set on the record he may see
        (await SetAsync(CoOwner, shown, shownKey, words: "दिसतं")).Status.Should().Be("applied");

        var refused = await SetAsync(CoOwner, hidden, hiddenKey, words: SecretWords);
        var madeUp = await SetAsync(CoOwner, Guid.NewGuid(), hiddenKey, words: SecretWords);
        refused.Status.Should().Be("failed");
        Shape(refused).Should().Be(Shape(madeUp), "a record kept from him is no oracle");
        (await RowsAsync()).Should().Be(1, "nothing was written for the hidden record");

        // the owner keeps a reason on it; it is never served to the co-owner
        await SetOkAsync(Owner, hidden, hiddenKey, "Weather", SecretWords);
        var (status, body) = await CompareAsync(CoOwner, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        body.Should().NotContain(SecretWords).And.NotContain(hidden.ToString());
        OwnWorkOf(Json(body), plot, shown).GetProperty("reason").GetProperty("words").GetString().Should().Be("दिसतं");
        // the owner still reads his own
        OwnWorkOf(await CompareOkAsync(Owner, FarmA), plot, hidden).GetProperty("reason").GetProperty("words").GetString().Should().Be(SecretWords);
    }

    // ---- what a reason may say ----------------------------------------------------------------------------------

    [Fact]
    public async Task A_kind_outside_the_three_is_refused_with_nothing_written()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        await SetOkAsync(Owner, log, key, "Practice"); // not vacuous
        foreach (var kind in new[] { "Other", "weather", "WEATHER", "", " ", "Practice ", "1" })
        {
            var refused = await SetAsync(Owner, log, key, kind, SecretWords);
            refused.Status.Should().Be("failed", $"kind '{kind}'");
            (refused.ErrorCode ?? "").Should().EndWith("SyncInvalidPayload");
        }

        (await RowsAsync()).Should().Be(1, "only the first, valid one");
    }

    [Fact]
    public async Task Words_over_1000_characters_are_refused_and_exactly_1000_are_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        var refused = await SetAsync(Owner, log, key, "Extra", new string('क', 1001));
        refused.Status.Should().Be("failed");
        (refused.ErrorCode ?? "").Should().EndWith("SyncInvalidPayload");
        (await RowsAsync()).Should().Be(0);

        await SetOkAsync(Owner, log, key, "Extra", new string('क', 1000));
        (await ReasonRowsAsync()).Single().Words!.Length.Should().Be(1000);
    }

    [Fact]
    public async Task A_work_key_the_record_does_not_have_is_refused_with_its_words_and_nothing_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);

        await SetOkAsync(Owner, log, key); // not vacuous
        foreach (var wrong in new[] { "spray:fungicide", "irrigation", "work:op_not_in_this_record", "unrecognised", "x" })
        {
            var refused = await SetAsync(Owner, log, wrong, words: SecretWords);
            refused.Status.Should().Be("failed", wrong);
            (refused.ErrorCode ?? "").Should().EndWith("SyncInvalidPayload");
        }

        (await RowsAsync()).Should().Be(1);
    }

    [Fact]
    public async Task A_record_the_recogniser_cannot_read_never_carries_a_reason()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var unreadable = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "zxqv wlmk");

        foreach (var key in new[] { "unrecognised", "work", "zxqv wlmk" })
        {
            var refused = await SetAsync(Owner, unreadable, key, words: SecretWords);
            refused.Status.Should().Be("failed", key);
            (refused.ErrorCode ?? "").Should().EndWith("SyncInvalidPayload", "R12: a not-recognised record is never counted as anything, and no reason is kept on it");
        }

        (await RowsAsync()).Should().Be(0);
    }

    [Fact]
    public async Task A_repeat_of_a_reason_id_by_another_person_or_on_another_record_is_refused_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        var (second, secondKey) = await OwnWorkRecordAsync(plot, cycle, day: 18);
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare);
        var id = Guid.NewGuid();
        await SetOkAsync(Owner, log, key, "Practice", "पहिलं", reasonId: id);

        var byOther = await SetAsync(CoOwner, log, key, "Weather", "दुसरं", reasonId: id, requestId: $"other-{Guid.NewGuid():N}");
        byOther.Status.Should().Be("failed");
        (byOther.ErrorCode ?? "").Should().EndWith("SyncInvalidPayload");
        var onOtherRecord = await SetAsync(Owner, second, secondKey, "Weather", "दुसरं", reasonId: id, requestId: $"other-{Guid.NewGuid():N}");
        onOtherRecord.Status.Should().Be("failed");
        (await ReasonRowsAsync()).Should().ContainSingle().Which.Words.Should().Be("पहिलं", "the first reason is never edited");
    }

    // ---- money words (D-66 / D-69) ------------------------------------------------------------------------------

    [Fact]
    public async Task Words_are_withheld_from_a_reader_who_may_not_hear_a_record_that_states_money_and_the_kind_is_still_given()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (moneyLog, moneyKey) = await OwnWorkRecordAsync(plot, cycle, notes: MoneyNote);
        var (plainLog, plainKey) = await OwnWorkRecordAsync(plot, cycle, day: 18);
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare);
        await SetOkAsync(Owner, moneyLog, moneyKey, "Extra", "मजुरी दिली म्हणून", voice: true);
        await SetOkAsync(Owner, plainLog, plainKey, "Weather", "पाऊस");

        var co = await CompareOkAsync(CoOwner, FarmA);
        var withheld = OwnWorkOf(co, plot, moneyLog).GetProperty("reason");
        withheld.GetProperty("kind").GetString().Should().Be("Extra", "the kind is always given");
        withheld.GetProperty("words").ValueKind.Should().Be(JsonValueKind.Null, "the record states money and he does not hear wages (D-66)");
        withheld.GetProperty("saidByVoice").GetBoolean().Should().BeFalse("no words, so nothing spoken is shown");
        OwnWorkOf(co, plot, plainLog).GetProperty("reason").GetProperty("words").GetString().Should().Be("पाऊस", "a record that states no money keeps its reason words");
        co.GetRawText().Should().NotContain("मजुरी दिली म्हणून");

        // the owner (hears everything) and a co-owner who also hears wages read them
        OwnWorkOf(await CompareOkAsync(Owner, FarmA), plot, moneyLog).GetProperty("reason").GetProperty("words").GetString().Should().Be("मजुरी दिली म्हणून");
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        OwnWorkOf(await CompareOkAsync(CoOwner, FarmA), plot, moneyLog).GetProperty("reason").GetProperty("words").GetString()
            .Should().Be("मजुरी दिली म्हणून", "a reader who hears wages hears the words");
    }

    [Fact]
    public async Task Words_that_state_money_themselves_are_withheld_from_a_reader_who_does_not_hear_wages_but_never_from_their_author()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare);
        await ReasonAuthoritiesAsync(Mukadam, FarmAuthority.SeeCompare);
        const string moneyWords = "५०० रु. जास्त द्यावे लागले";
        await SetOkAsync(Owner, log, key, "Extra", moneyWords);

        OwnWorkOf(await CompareOkAsync(Owner, FarmA), plot, log).GetProperty("reason").GetProperty("words").GetString().Should().Be(moneyWords);
        var co = OwnWorkOf(await CompareOkAsync(CoOwner, FarmA), plot, log).GetProperty("reason");
        co.GetProperty("kind").GetString().Should().Be("Extra");
        co.GetProperty("words").ValueKind.Should().Be(JsonValueKind.Null, "words that state money are not heard by a reader who does not hear wages (D-69)");

        // a co-owner's OWN money words: he reads his own, the mukadam (no wages) does not
        await SetOkAsync(CoOwner, log, key, "Extra", moneyWords + " (सीमा)");
        OwnWorkOf(await CompareOkAsync(CoOwner, FarmA), plot, log).GetProperty("reason").GetProperty("words").GetString()
            .Should().Be(moneyWords + " (सीमा)", "the author always reads his own words");
        var mukadam = OwnWorkOf(await CompareOkAsync(Mukadam, FarmA), plot, log).GetProperty("reason");
        mukadam.GetProperty("words").ValueKind.Should().Be(JsonValueKind.Null);
        mukadam.GetProperty("kind").GetString().Should().Be("Extra");
    }

    // ---- fix round 1: P001 (no words in any stored push answer), P005 (an id clash across farms parks), P004 (loud failure) -------

    [Fact]
    public async Task The_authors_words_are_in_no_stored_push_answer_no_audit_row_and_no_table_but_the_reason_itself()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        const string words = "zq-secret-reason-8841"; // ASCII on purpose: a JSON copy would otherwise hide it behind unicode escapes
        var id = Guid.NewGuid();

        var applied = await SetAsync(Owner, log, key, "Weather", words, voice: true, reasonId: id);
        applied.Status.Should().Be("applied", $"{applied.ErrorCode}: {applied.ErrorMessage}");
        JsonSerializer.Serialize(applied.Data).Should().NotContain(words, "the answer the phone gets carries no words");
        JsonSerializer.Serialize(applied.Data).Should().Contain(id.ToString(), "the precondition: the answer is not empty");

        var replay = await SetAsync(Owner, log, key, "Weather", words, voice: true, reasonId: id);
        replay.Status.Should().Be("duplicate");
        JsonSerializer.Serialize(replay.Data).Should().NotContain(words, "a replay carries none either");

        var stored = await ScalarTextAsync("SELECT response_payload_json FROM ssf.sync_mutations WHERE client_request_id = @r", ("r", $"cmpd3-reason-{id:N}"));
        stored.Should().NotBeNull("the precondition: the push door stored its answer");
        stored!.Should().Contain(id.ToString()).And.NotContain(words, "the stored answer is the one a replay is made from");

        // every other table of the schema: the words are in the reason row and nowhere else (audit rows, outbox, ledgers, logs of any kind)
        (await CountAsync("SELECT count(*) FROM ssf.log_practice_reasons WHERE words = @w", ("w", words))).Should().Be(1, "the precondition: the words are stored once, here");
        var tables = new List<string>();
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'ssf' AND table_type = 'BASE TABLE' AND table_name <> 'log_practice_reasons'";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                tables.Add(reader.GetString(0));
            }
        }

        tables.Should().Contain("sync_mutations").And.Contain("audit_events");
        var holding = new List<string>();
        foreach (var table in tables)
        {
            if (await CountAsync($"SELECT count(*) FROM ssf.\"{table}\" x WHERE x::text LIKE @w", ("w", $"%{words}%")) > 0)
            {
                holding.Add(table);
            }
        }

        holding.Should().BeEmpty("the author's words must exist in no other table (erasure scrubs only the reason row)");
    }

    [Fact]
    public async Task A_reason_id_that_clashes_with_a_row_of_another_farm_is_a_refusal_that_parks_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare);
        var used = Guid.NewGuid();
        await SetOkAsync(Owner, log, key, "Practice", "पहिलं", reasonId: used);
        var sameFarm = await SetAsync(CoOwner, log, key, "Weather", "दुसरं", reasonId: used, requestId: $"same-{Guid.NewGuid():N}");
        sameFarm.Status.Should().Be("failed", "the precondition: a reason id used on this farm is refused");

        var planted = Guid.NewGuid();
        await ExecOnSuperuserAsync(
            """
            INSERT INTO ssf.log_practice_reasons ("Id", farm_id, daily_log_id, work_key, kind, words, said_by_voice, author_user_id, created_at_utc)
            VALUES (@id, @f, gen_random_uuid(), 'work', 'Practice', 'दुसऱ्या शेताचं', false, @u, NOW())
            """,
            ("id", planted), ("f", FarmB), ("u", OwnerB));
        var rowsBefore = await RowsAsync();
        var auditBefore = await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'LogPracticeReasonSet'");

        var clash = await SetAsync(Owner, log, key, "Weather", SecretWords, reasonId: planted, requestId: $"clash-{Guid.NewGuid():N}");
        clash.Status.Should().Be("failed");
        (clash.ErrorCode ?? "").Should().EndWith("SyncInvalidPayload", "it parks: an id of another farm can never be applied, never retried");
        Shape(clash).Should().Be(Shape(sameFarm), "the same refusal, word for word, as a reason id reused on this farm (no oracle for another farm's id)");
        (clash.ErrorMessage ?? "").Should().NotContain(SecretWords).And.NotContain("दुसऱ्या शेताचं");
        (await RowsAsync()).Should().Be(rowsBefore, "nothing was written");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'LogPracticeReasonSet'")).Should().Be(auditBefore, "rolled back in full");
    }

    [Fact]
    public async Task The_words_scrub_fails_loudly_on_a_connection_that_row_security_filters_and_changes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        await SetOkAsync(Owner, log, key, "Weather", "पाऊस आला");

        await using var app = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(AppConn).Options);
        var scrub = () => ErasureWorker.ScrubLogPracticeReasonWordsAsync(app, Owner, CancellationToken.None);
        await scrub.Should().ThrowAsync<InvalidOperationException>("as agrisync_app (not superuser, no bypassrls, no UPDATE) the scrub must refuse, never report success");
        (await ReasonRowsAsync()).Single().Words.Should().Be("पाऊस आला", "nothing changed");
    }

    // P001 (every other place the words could be stored): lane 2b keeps a REFUSED mutation whole, as an audit row, for the owner when the sender once
    // worked on the farm. For a reason that would copy the author's words into ssf.audit_events, which erasure does not scrub. A refused reason is kept
    // as nothing: the refusal stays on his phone (parked, visible); his words never reach any table.
    [Fact]
    public async Task A_reason_refused_for_want_of_authority_is_not_kept_whole_for_the_owner_so_its_words_reach_no_table()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        const string words = "zq-refused-words-5520"; // ASCII on purpose

        // a mukadam who works on the farm but holds no "तुलना पाहणे": refused, and he once worked here, so lane 2b WOULD keep the mutation for the owner
        var refused = await SetAsync(Mukadam, log, key, "Weather", words);
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be("ShramSafal.Forbidden", "the precondition: it is an authority refusal (the kind lane 2b keeps)");

        (await RowsAsync()).Should().Be(0, "nothing was written");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events x WHERE x::text LIKE @w", ("w", $"%{words}%")))
            .Should().Be(0, "the refused reason's words are in no audit row (nor in any kept copy of the refused mutation)");
    }

    // ---- erasure ------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Erasure_of_the_author_removes_his_words_and_keeps_the_kind_and_another_authors_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        var (second, secondKey) = await OwnWorkRecordAsync(plot, cycle, day: 18);
        await ReasonAuthoritiesAsync(CoOwner, FarmAuthority.SeeCompare);
        await SetOkAsync(Owner, log, key, "Weather", "पाऊस आला", voice: true);
        await SetOkAsync(Owner, log, key, "Extra", "जास्त काम होतं");
        await SetOkAsync(CoOwner, second, secondKey, "Practice", "माझी पद्धत", voice: true);
        var before = await ReasonRowsAsync();
        before.Should().HaveCount(3);

        await using var admin = NewSuperuserContext();
        (await ErasureWorker.ScrubLogPracticeReasonWordsAsync(admin, Owner, CancellationToken.None)).Should().Be(2, "both of his reasons that hold words");

        var after = await ReasonRowsAsync();
        after.Should().HaveCount(3, "the rows survive (P6: anonymise the person, never the work)");
        foreach (var (was, now) in before.Zip(after))
        {
            now.Id.Should().Be(was.Id);
            now.Kind.Should().Be(was.Kind, "the KIND stays");
            now.Key.Should().Be(was.Key);
            now.Log.Should().Be(was.Log);
            now.Supersedes.Should().Be(was.Supersedes);
            now.Author.Should().Be(was.Author, "the opaque id stays, as on every other append-only table");
            if (was.Author == Owner)
            {
                now.Words.Should().BeNull("his words are erased");
                now.Voice.Should().BeFalse();
            }
            else
            {
                now.Words.Should().Be(was.Words, "another person's words on the same record are not his to erase");
                now.Voice.Should().Be(was.Voice);
            }
        }

        await using var admin2 = NewSuperuserContext();
        (await ErasureWorker.ScrubLogPracticeReasonWordsAsync(admin2, Owner, CancellationToken.None)).Should().Be(0, "a second run changes nothing");

        // what is served afterwards: the kind, no words
        var reason = OwnWorkOf(await CompareOkAsync(Owner, FarmA), plot, log).GetProperty("reason");
        reason.GetProperty("kind").GetString().Should().Be("Extra");
        reason.GetProperty("words").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public void The_erasure_worker_runs_the_reason_scrub_and_names_the_columns_it_scrubbed()
    {
        var text = ReadSource("src/apps/ShramSafal/ShramSafal.Infrastructure/Privacy/ErasureWorker.cs");
        var call = "perTableCounts[\"log_practice_reasons\"] = await ScrubLogPracticeReasonWordsAsync(admin, targetUserId, ct)";
        text.Should().Contain(call);
        // P004: the call is inside ProcessOneAsync (after its declaration) and on a line that is not a comment; the full pass is proved in
        // LogPracticeReasonErasureRealPostgresTests, which cannot pass if the call is dead
        var start = text.IndexOf("private async Task ProcessOneAsync(", StringComparison.Ordinal);
        start.Should().BeGreaterThan(0);
        var at = text.IndexOf(call, StringComparison.Ordinal);
        at.Should().BeGreaterThan(start, "the call sits inside the per-request processing, not above it");
        var lineStart = text.LastIndexOf((char)10, at) + 1;
        text.Substring(lineStart, at - lineStart).TrimStart().Should().NotStartWith("//", "the call is not commented out");
        text.Should().Contain("\"log_practice_reasons\" => new[] { \"words\", \"said_by_voice\" }");
        text.Should().Contain("ssf.log_practice_reasons");
    }

    // ---- the migration ------------------------------------------------------------------------------------------

    [Fact]
    public async Task The_app_role_may_append_and_read_reasons_but_never_update_delete_or_truncate_them()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle) = await PlotAsync();
        var (log, key) = await OwnWorkRecordAsync(plot, cycle);
        await SetOkAsync(Owner, log, key, "Practice", "माझी पद्धत");

        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        foreach (var privilege in new[] { "SELECT", "INSERT" })
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT has_table_privilege(current_user, 'ssf.log_practice_reasons', '{privilege}')";
            (await cmd.ExecuteScalarAsync()).Should().Be(true, $"the app role appends and reads ({privilege})");
        }

        foreach (var privilege in new[] { "UPDATE", "DELETE", "TRUNCATE" })
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT has_table_privilege(current_user, 'ssf.log_practice_reasons', '{privilege}')";
            (await cmd.ExecuteScalarAsync()).Should().Be(false, $"a reason is never edited or removed ({privilege} is revoked)");
        }

        foreach (var sql in new[]
                 {
                     "UPDATE ssf.log_practice_reasons SET kind = 'Extra'",
                     "DELETE FROM ssf.log_practice_reasons",
                     "TRUNCATE ssf.log_practice_reasons",
                 })
        {
            (await RefusedAsAppAsync(FarmA, sql)).Should().Be("42501", $"{sql} must be refused by privilege");
        }

        (await ReasonRowsAsync()).Should().ContainSingle().Which.Kind.Should().Be("Practice", "the refused writes changed nothing");
    }

    [Fact]
    public async Task Reasons_of_another_farm_are_invisible_and_cannot_be_written_as_agrisync_app()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReasonAsync(FarmA);
        await SeedReasonAsync(FarmB);

        (await CountAsAppAsync(FarmA)).Should().Be(1, "under its own farm's scope the row is there (else the proof is vacuous)");
        (await CountAsAppAsync(FarmB)).Should().Be(1, "farm B's scope sees only farm B's row");
        (await CountAsAppAsync(null)).Should().Be(0, "no scope sees nothing");

        var insert = $"""
            INSERT INTO ssf.log_practice_reasons ("Id", farm_id, daily_log_id, work_key, kind, words, said_by_voice, author_user_id, created_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}', gen_random_uuid(), 'work', 'Practice', NULL, false, '{Owner}', NOW())
            """;
        (await RefusedAsAppAsync(FarmB, insert)).Should().Be("42501", "a row policy refuses a row of another farm (WITH CHECK)");
        // the kind is one of three, in the table itself
        var badKind = $"""
            INSERT INTO ssf.log_practice_reasons ("Id", farm_id, daily_log_id, work_key, kind, words, said_by_voice, author_user_id, created_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}', gen_random_uuid(), 'work', 'Other', NULL, false, '{Owner}', NOW())
            """;
        (await RefusedAsAppAsync(FarmA, badKind)).Should().Be("23514", "the kind CHECK holds on its own");
    }

    [Fact]
    public async Task The_table_is_forced_under_row_security_with_the_tenant_policy_and_no_user_select_policy()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await CountAsync("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname = 'log_practice_reasons' AND c.relrowsecurity AND c.relforcerowsecurity"))
            .Should().Be(1);
        (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = 'log_practice_reasons' AND policyname = 'p_tenant_log_practice_reasons'"))
            .Should().Be(1);
        (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = 'log_practice_reasons'"))
            .Should().Be(1, "the only policy is the tenant one: every reader opens the farm's scope, so no user-select policy is needed");
    }

    [Fact]
    public void The_suites_guard_lists_carry_the_table_and_the_migration()
    {
        var ledgers = ReadSource("src/tests/ShramSafal.Sync.IntegrationTests/Security/AppendOnlyLedgerGrantsRealPostgresTests.cs");
        ledgers.Should().Contain("\"ssf.log_practice_reasons\"", "the table is named in AppendOnlyLedgers");
        ledgers.Should().Contain("\"" + MigrationId + "\"");
        ReadSource("src/tests/ShramSafal.Sync.IntegrationTests/Audit/AuditEventIsolationRealPostgresTests.cs").Should().Contain("\"" + MigrationId + "\"");
        ReadSource("src/tests/ShramSafal.Sync.IntegrationTests/Memberships/PendingJoinRequestAccessRealPostgresTests.cs").Should().Contain("\"" + MigrationId + "\"");
    }

    [Fact]
    public async Task The_migration_Down_drops_the_table_and_Up_brings_it_back_append_only()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReasonAsync(FarmA);
        (await TableCountAsync()).Should().Be(1);

        await MigrateAsync(MigrationBefore);
        (await TableCountAsync()).Should().Be(0, "Down() drops the table (every reason is lost; ownWork[].reason reads null again)");
        (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = 'log_practice_reasons'")).Should().Be(0);

        await MigrateAsync(null);
        (await TableCountAsync()).Should().Be(1, "Up() recreates it");
        (await RowsAsync()).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname = 'log_practice_reasons' AND c.relforcerowsecurity")).Should().Be(1);
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT has_table_privilege(current_user, 'ssf.log_practice_reasons', 'UPDATE') OR has_table_privilege(current_user, 'ssf.log_practice_reasons', 'DELETE') OR has_table_privilege(current_user, 'ssf.log_practice_reasons', 'TRUNCATE')";
        (await cmd.ExecuteScalarAsync()).Should().Be(false, "the grants come back append-only too");
    }

    [Fact]
    public void The_route_table_is_unchanged_a_reason_has_no_REST_path()
    {
        var routes = ReadSource("sync-contract/routes/server-rest-routes.txt").Replace("\r\n", "\n").Split('\n');
        routes.Should().NotContain(r => r.Contains("logreason", StringComparison.OrdinalIgnoreCase) || r.Contains("practice-reason", StringComparison.OrdinalIgnoreCase) || r.Contains("log-reason", StringComparison.OrdinalIgnoreCase), "logreason.set is a sync mutation only");
    }

    // ---- plumbing -----------------------------------------------------------------------------------------------

    private async Task<string?> ScalarTextAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync() as string;
    }

    private Task<long> TableCountAsync() => CountAsync(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name = 'log_practice_reasons'");

    private async Task MigrateAsync(string? target)
    {
        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options);
        var migrator = db.Database.GetService<IMigrator>();
        if (target is null)
        {
            await migrator.MigrateAsync();
        }
        else
        {
            await migrator.MigrateAsync(target);
        }
    }

    private async Task SeedReasonAsync(Guid farm) =>
        await ExecOnSuperuserAsync(
            """
            INSERT INTO ssf.log_practice_reasons ("Id", farm_id, daily_log_id, work_key, kind, words, said_by_voice, author_user_id, created_at_utc)
            VALUES (gen_random_uuid(), @f, gen_random_uuid(), 'work', 'Practice', 'शब्द', false, @u, NOW())
            """,
            ("f", farm), ("u", Owner));

    /// <summary>Rows visible to agrisync_app under a farm scope (null = no scope at all).</summary>
    private async Task<long> CountAsAppAsync(Guid? farm)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        if (farm is { } f)
        {
            await using var set = db.CreateCommand();
            set.Transaction = tx;
            set.CommandText = $"SELECT set_config('agrisync.farm_id', '{f}', true)";
            await set.ExecuteNonQueryAsync();
        }

        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT count(*) FROM ssf.log_practice_reasons";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>The SQLSTATE agrisync_app is refused with for <paramref name="sql"/> under a farm scope (null = it was NOT refused).</summary>
    private async Task<string?> RefusedAsAppAsync(Guid farm, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var set = db.CreateCommand())
        {
            set.Transaction = tx;
            set.CommandText = $"SELECT set_config('agrisync.farm_id', '{farm}', true)";
            await set.ExecuteNonQueryAsync();
        }

        try
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
    }

    private static string ReadSource(string relative)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, relative.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(candidate))
            {
                return File.ReadAllText(candidate);
            }

            current = current.Parent;
        }

        throw new FileNotFoundException("The suite's own source was not found above the test output: " + relative);
    }
}
