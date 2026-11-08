// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-3 Tasks 1-2 (founder D-24d, D-30, D-1, P3, E4, D-26; P4).
//
// "काम झालं" through the real push handler, on a real Postgres as agrisync_app (E3 first, in every fact): handed-out work needs a
// real log on the plots done; a reminder is done without one; a two-plot task done on one plot stays partly done; somethingLeft
// keeps it pending; a log of another farm or another plot is refused; the old assignee after a reassign is refused (and
// stays refused on a closed task); reopen is the primary owner's alone; verifying the linked log moves the task to Confirmed on
// the next pull of BOTH phones and a doubt shows Disputed without reopening; and no job card, cost, attendance or labour row is
// written by any planned-work step or by confirming the linked log.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlannedWorkCompleteRealPostgresTests(ITestOutputHelper output) : PlannedWorkLane(output)
{
    private const string Day = "2026-11-08";

    private Task<SyncMutationResultDto> CompleteAsync(
        Guid actor, Guid task, Guid[] plots, Guid[] logs, bool left = false, Guid? farm = null) =>
        PushAsync(actor, "plannedwork.complete", $"pw-complete-{task:N}-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = task,
            ["farmId"] = farm ?? FarmA,
            ["plotIds"] = plots,
            ["dailyLogIds"] = logs,
            ["somethingLeft"] = left,
        });

    private Task<SyncMutationResultDto> ReopenAsync(Guid actor, Guid task, string? reason) =>
        PushAsync(actor, "plannedwork.reopen", $"pw-reopen-{task:N}-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = task,
            ["farmId"] = FarmA,
            ["reason"] = reason ?? string.Empty,
        });

    /// <summary>A real log through the real write path (create_daily_log), on a plot of farm A unless told otherwise.</summary>
    private async Task<Guid> LogAsync(Guid actor, Guid plot, Guid cycle, Guid? farm = null, bool details = false)
    {
        var id = Guid.NewGuid();
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = id,
            ["farmId"] = farm ?? FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["operatorUserId"] = actor,
            ["logDate"] = Day,
        };
        if (details)
        {
            payload["content"] = new { schema = 1 }; // the details a move needs the server to hold
        }

        var result = await PushAsync(actor, "create_daily_log", $"pw-log-{id:N}", payload);
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return id;
    }

    private async Task<SyncMutationResultDto> DecideAsync(Guid owner, Guid log, string decision, string? reason = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["logId"] = log,
            ["verifierUserId"] = owner,
            ["decision"] = decision,
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        };
        if (reason is not null)
        {
            payload["reason"] = reason;
        }

        var result = await PushAsync(owner, "verify_log_v2", $"pw-decide-{log:N}-{decision}", payload);
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    private async Task<Guid> HandOutAsync(Guid to, Guid[] plots, string scope)
    {
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: to, plots: plots, scope: scope);
        (await StepAsync(to, "accept", task)).Status.Should().Be("applied");
        return task;
    }

    private sealed record Plot(Guid Id, string Status, Guid? DoneBy, DateTime? DoneAt, Guid[] Logs);

    private async Task<List<Plot>> PlotsOfAsync(Guid task)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT plot_id, status, done_by_user_id, done_at_utc, linked_daily_log_ids
            FROM ssf.planned_work_plots WHERE planned_work_id = @id ORDER BY plot_id
            """;
        cmd.Parameters.AddWithValue("id", task);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<Plot>();
        while (await reader.ReadAsync())
        {
            rows.Add(new Plot(
                reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetGuid(2),
                reader.IsDBNull(3) ? null : reader.GetDateTime(3), reader.GetFieldValue<Guid[]>(4)));
        }

        return rows;
    }

    private async Task<(Guid[] Logs, DateTime? DoneAt, Guid? DoneBy)> DoneStampsAsync(Guid task)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT linked_daily_log_ids, done_at_utc, done_by_user_id FROM ssf.planned_work WHERE id = @id";
        cmd.Parameters.AddWithValue("id", task);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        return (reader.GetFieldValue<Guid[]>(0), reader.IsDBNull(1) ? null : reader.GetDateTime(1), reader.IsDBNull(2) ? null : reader.GetGuid(2));
    }

    private static JsonElement? InPull(JsonElement root, Guid task) =>
        TasksOf(root).Where(t => t.GetProperty("id").GetGuid() == task).Select(t => (JsonElement?)t).FirstOrDefault();

    [Fact]
    public async Task Handed_out_work_without_a_log_is_refused_and_a_reminder_is_done_without_one()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");
        var refused = await CompleteAsync(Mukadam, task, [PlotA], []);
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be("ShramSafal.PlannedWorkLog.InvalidCommand");
        (await RowAsync(task))!.Status.Should().Be("Accepted");
        (await PlotsOfAsync(task)).Should().OnlyContain(p => p.Status == "Pending");

        // D-1: his own reminder, "झाले", needs no log.
        var reminder = Guid.NewGuid();
        await MadeAsync(Mukadam, reminder, assignee: null, plots: [PlotA], scope: "Plot");
        var done = await CompleteAsync(Mukadam, reminder, [PlotA], []);
        done.Status.Should().Be("applied", $"{done.ErrorCode}: {done.ErrorMessage}");
        (await RowAsync(reminder))!.Status.Should().Be("Done");
        (await PlotsOfAsync(reminder)).Should().OnlyContain(p => p.Status == "Done" && p.DoneBy == Mukadam);
        (await DoneStampsAsync(reminder)).DoneBy.Should().Be(Mukadam);
    }

    [Fact]
    public async Task Urea_on_two_plots_done_on_the_first_leaves_the_second_pending_the_task_partly_done_and_counted_once()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Sugarcane");
        var task = await HandOutAsync(Mukadam, [PlotA, plot2], "MultiPlot");
        var logA = await LogAsync(Mukadam, PlotA, CycleA);

        var first = await CompleteAsync(Mukadam, task, [PlotA], [logA]);
        first.Status.Should().Be("applied", $"{first.ErrorCode}: {first.ErrorMessage}");
        (await RowAsync(task))!.Status.Should().Be("Accepted", "one plot of two is not the work done");
        var plots = await PlotsOfAsync(task);
        plots.Single(p => p.Id == PlotA).Status.Should().Be("Done");
        plots.Single(p => p.Id == PlotA).Logs.Should().Equal(logA);
        plots.Single(p => p.Id == plot2).Status.Should().Be("Pending");
        plots.Single(p => p.Id == plot2).Logs.Should().BeEmpty();
        (await TaskCountAsync()).Should().Be(1, "the task counts once");

        // The pull says so, with a line per plot.
        var (_, pulled) = await PullAsync(Owner);
        var dto = InPull(pulled, task)!.Value;
        dto.GetProperty("status").GetString().Should().Be("Accepted");
        dto.GetProperty("plots").EnumerateArray().Select(p => p.GetProperty("status").GetString()).Should().BeEquivalentTo(["Done", "Pending"]);

        var logB = await LogAsync(Mukadam, plot2, cycle2);
        (await CompleteAsync(Mukadam, task, [plot2], [logB])).Status.Should().Be("applied");
        (await RowAsync(task))!.Status.Should().Be("Done");
        (await DoneStampsAsync(task)).Logs.Should().BeEquivalentTo([logA, logB]);

        // A second complete for plots already done is a no-op that un-does nothing.
        var stamps = await DoneStampsAsync(task);
        var again = await CompleteAsync(Mukadam, task, [PlotA], [logA], left: true);
        again.Status.Should().Be("applied", "a replay under a new request id is answered, not refused");
        (await RowAsync(task))!.Status.Should().Be("Done");
        (await DoneStampsAsync(task)).DoneAt.Should().Be(stamps.DoneAt);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'PlannedWork' AND entity_id = @id AND action = 'PlannedWorkCompleted'", ("id", task)))
            .Should().Be(2, "one per applied complete; the replay wrote nothing");
    }

    [Fact]
    public async Task SomethingLeft_links_the_log_and_keeps_the_task_pending()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");
        var log = await LogAsync(Mukadam, PlotA, CycleA);

        (await CompleteAsync(Mukadam, task, [PlotA], [log], left: true)).Status.Should().Be("applied");
        (await RowAsync(task))!.Status.Should().Be("Accepted", "never Done while something is left");
        (await DoneStampsAsync(task)).Logs.Should().Equal(log);
        (await DoneStampsAsync(task)).DoneAt.Should().BeNull();

        // Later he says nothing is left: the same log, the work is Done.
        (await CompleteAsync(Mukadam, task, [PlotA], [log], left: false)).Status.Should().Be("applied");
        (await RowAsync(task))!.Status.Should().Be("Done");
    }

    [Fact]
    public async Task A_log_on_another_farm_or_another_plot_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Sugarcane");
        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");

        var onOtherPlot = await LogAsync(Mukadam, plot2, cycle2);
        var wrongPlot = await CompleteAsync(Mukadam, task, [PlotA], [onOtherPlot]);
        wrongPlot.Status.Should().Be("failed");
        wrongPlot.ErrorCode.Should().Be("ShramSafal.PlannedWorkLog.InvalidCommand");

        var farmBLog = FarmBLog;
        var foreign = await CompleteAsync(Mukadam, task, [PlotA], [farmBLog]);
        foreign.Status.Should().Be("failed");
        foreign.ErrorCode.Should().Be("ShramSafal.DailyLogNotFound", "another farm's log answers like a made-up one");
        var madeUp = await CompleteAsync(Mukadam, task, [PlotA], [Guid.NewGuid()]);
        madeUp.ErrorCode.Should().Be(foreign.ErrorCode);
        madeUp.ErrorMessage.Should().Be(foreign.ErrorMessage);

        (await RowAsync(task))!.Status.Should().Be("Accepted");
        (await DoneStampsAsync(task)).Logs.Should().BeEmpty();
    }

    [Fact]
    public async Task A_plot_of_another_farm_with_this_farm_id_is_refused_like_an_unknown_plot()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");
        var log = await LogAsync(Mukadam, PlotA, CycleA);

        var foreign = await CompleteAsync(Mukadam, task, [PlotB], [log]);
        var unknown = await CompleteAsync(Mukadam, task, [Guid.NewGuid()], [log]);
        foreign.Status.Should().Be("failed");
        foreign.ErrorCode.Should().Be("ShramSafal.PlannedWorkPlots.InvalidCommand");
        foreign.ErrorCode.Should().EndWith(".InvalidCommand", "every phone in the field parks a code ending so (P10)");
        unknown.ErrorCode.Should().Be(foreign.ErrorCode);
        unknown.ErrorMessage.Should().Be(foreign.ErrorMessage);

        // Another farm's task id is not found (E4): the owner of farm B names farm A's task with farm B's id.
        var other = await CompleteAsync(OwnerB, task, [PlotA], [log], farm: FarmB);
        var madeUp = await CompleteAsync(OwnerB, Guid.NewGuid(), [PlotA], [log], farm: FarmB);
        other.Status.Should().Be("failed");
        other.ErrorCode.Should().Be(madeUp.ErrorCode);
        (await RowAsync(task))!.Status.Should().Be("Accepted");
    }

    [Fact]
    public async Task A_complete_from_the_old_assignee_after_reassignment_is_Forbidden_and_stays_Forbidden_once_done()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");
        var log = await LogAsync(Mukadam, PlotA, CycleA);

        // The owner hands the work to Worker 2 (covering the plot).
        var reassigned = await EditAsync(Owner, task, assignee: Worker2);
        reassigned.Status.Should().Be("applied", $"{reassigned.ErrorCode}: {reassigned.ErrorMessage}");

        var old = await CompleteAsync(Mukadam, task, [PlotA], [log]);
        old.Status.Should().Be("failed");
        old.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await RowAsync(task))!.Status.Should().Be("Assigned");
        (await PlotsOfAsync(task)).Should().OnlyContain(p => p.Status == "Pending");

        // Not even the owner says it for him: a PlanWork holder cannot mark done for the assignee.
        (await CompleteAsync(Owner, task, [PlotA], [log])).ErrorCode.Should().Be("ShramSafal.Forbidden");

        var workers = await LogAsync(Worker2, PlotA, CycleA);
        (await CompleteAsync(Worker2, task, [PlotA], [workers])).Status.Should().Be("applied");
        (await RowAsync(task))!.Status.Should().Be("Done");
        (await CompleteAsync(Mukadam, task, [PlotA], [log])).ErrorCode.Should().Be("ShramSafal.Forbidden", "the person comes before the state");
    }

    [Fact]
    public async Task Reopen_by_a_non_owner_is_refused_and_the_owner_reopens_with_a_reason_kept_in_the_audit()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Sugarcane");
        var task = await HandOutAsync(Mukadam, [PlotA, plot2], "MultiPlot");
        var logA = await LogAsync(Mukadam, PlotA, CycleA);
        var logB = await LogAsync(Mukadam, plot2, cycle2);
        (await CompleteAsync(Mukadam, task, [PlotA, plot2], [logA, logB])).Status.Should().Be("applied");
        (await RowAsync(task))!.Status.Should().Be("Done");

        foreach (var who in new[] { Mukadam, CoOwner, Worker })
        {
            var refused = await ReopenAsync(who, task, "काम नीट नाही");
            refused.Status.Should().Be("failed", $"{who} is not the primary owner");
            (await RowAsync(task))!.Status.Should().Be("Done");
        }

        (await ReopenAsync(Mukadam, task, "काम नीट नाही")).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await ReopenAsync(Owner, task, null)).Status.Should().Be("failed", "the owner needs a reason");
        (await RowAsync(task))!.Status.Should().Be("Done");

        var reopened = await ReopenAsync(Owner, task, "काम नीट नाही");
        reopened.Status.Should().Be("applied", $"{reopened.ErrorCode}: {reopened.ErrorMessage}");
        (await RowAsync(task))!.Status.Should().Be("Accepted");
        (await PlotsOfAsync(task)).Should().OnlyContain(p => p.Status == "Pending" && p.DoneAt == null && p.Logs.Length == 0);
        var stamps = await DoneStampsAsync(task);
        stamps.DoneAt.Should().BeNull();
        stamps.Logs.Should().BeEmpty();

        // History (P3) = the audit rows: the step and the reason, and nothing of the work's words.
        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await using var cmd = raw.CreateCommand();
        cmd.CommandText = "SELECT action, payload::text FROM ssf.audit_events WHERE entity_type = 'PlannedWork' AND entity_id = @id ORDER BY occurred_at_utc";
        cmd.Parameters.AddWithValue("id", task);
        var audit = new List<(string Action, JsonElement Payload)>();
        await using (var reader = await cmd.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                audit.Add((reader.GetString(0), JsonDocument.Parse(reader.GetString(1)).RootElement.Clone()));
            }
        }

        audit.Select(a => a.Action).Should().Equal("PlannedWorkCreated", "PlannedWorkAccepted", "PlannedWorkCompleted", "PlannedWorkReopened");
        audit[2].Payload.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["plannedWorkId", "farmId", "status", "step"]);
        audit[3].Payload.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["plannedWorkId", "farmId", "status", "step", "reason"]);
        audit[3].Payload.GetProperty("reason").GetString().Should().Be("काम नीट नाही");
        audit[3].Payload.GetProperty("status").GetString().Should().Be("Accepted");

        // A reopen of a task that is not Done has nothing to reopen.
        (await ReopenAsync(Owner, task, "पुन्हा")).ErrorCode.Should().Be("ShramSafal.PlannedWorkState.InvalidCommand");
    }

    [Fact]
    public async Task Verifying_the_linked_log_moves_the_task_to_Confirmed_on_the_next_pull_of_BOTH_phones_and_a_doubt_does_not_reopen()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");
        var log = await LogAsync(Mukadam, PlotA, CycleA);
        (await CompleteAsync(Mukadam, task, [PlotA], [log])).Status.Should().Be("applied");

        foreach (var phone in new[] { Owner, Mukadam })
        {
            var (_, first) = await PullAsync(phone);
            var dto = InPull(first, task)!.Value;
            dto.GetProperty("confirmationState").GetString().Should().Be("Waiting", $"nobody has confirmed the log yet ({phone})");
            dto.GetProperty("plots").EnumerateArray().Single().GetProperty("confirmationState").GetString().Should().Be("Waiting");
        }

        // Both phones have pulled up to here; the task is not sent again until something about it changes.
        var cursor = await CursorAfterNowAsync();
        foreach (var phone in new[] { Owner, Mukadam })
        {
            var (_, quiet) = await PullAsync(phone, cursor);
            InPull(quiet, task).Should().BeNull($"nothing changed for {phone}");
        }

        await DecideAsync(Owner, log, "verify");

        foreach (var phone in new[] { Owner, Mukadam })
        {
            var (_, next) = await PullAsync(phone, cursor);
            var dto = InPull(next, task);
            dto.Should().NotBeNull($"the confirmation moved the task past {phone}'s cursor");
            dto!.Value.GetProperty("confirmationState").GetString().Should().Be("Confirmed");
            dto.Value.GetProperty("plots").EnumerateArray().Single().GetProperty("confirmationState").GetString().Should().Be("Confirmed");
            dto.Value.GetProperty("status").GetString().Should().Be("Done", "a confirmation changes the word, not the work");
        }

        // A शंका on another task's log: Disputed, and the task is still Done (it does not reopen).
        var doubted = await HandOutAsync(Mukadam, [PlotA], "Plot");
        var doubtedLog = await LogAsync(Mukadam, PlotA, CycleA);
        (await CompleteAsync(Mukadam, doubted, [PlotA], [doubtedLog])).Status.Should().Be("applied");
        var before = await CursorAfterNowAsync();
        await DecideAsync(Owner, doubtedLog, "dispute", "प्रमाण चुकीचे वाटते");
        foreach (var phone in new[] { Owner, Mukadam })
        {
            var (_, pulled) = await PullAsync(phone, before);
            var dto = InPull(pulled, doubted)!.Value;
            dto.GetProperty("confirmationState").GetString().Should().Be("Disputed");
            dto.GetProperty("status").GetString().Should().Be("Done");
        }

        (await RowAsync(doubted))!.Status.Should().Be("Done");
    }

    [Fact]
    public async Task Verifying_through_the_REST_route_moves_the_task_past_the_cursor_too()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");
        var log = await LogAsync(Mukadam, PlotA, CycleA);
        (await CompleteAsync(Mukadam, task, [PlotA], [log])).Status.Should().Be("applied");
        var cursor = await CursorAfterNowAsync();
        (await PullAsync(Mukadam, cursor)).Root.Should().NotBeNull();
        InPull((await PullAsync(Mukadam, cursor)).Root, task).Should().BeNull("nothing has changed since the cursor");

        // The owner's confirm from the review screen's own route (not the queue): the same bump.
        var (status, body) = await SendJsonAsync(System.Net.Http.HttpMethod.Post, $"/shramsafal/logs/{log}/verify", Owner, new { status = "Verified" });
        status.Should().Be(System.Net.HttpStatusCode.OK, body);

        var dto = InPull((await PullAsync(Mukadam, cursor)).Root, task);
        dto.Should().NotBeNull("the confirmation moved the task past his cursor");
        dto!.Value.GetProperty("confirmationState").GetString().Should().Be("Confirmed");
    }

    // ── L003: the other doors that take a Verified log back to Draft must resend the tasks that link it ─────────────────

    /// <summary>A task handed to Mukadam, done with <paramref name="log"/>, the log confirmed by the owner: both phones read "Confirmed".</summary>
    private async Task<Guid> ConfirmedTaskAsync(Guid log)
    {
        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");
        (await CompleteAsync(Mukadam, task, [PlotA], [log])).Status.Should().Be("applied");
        await DecideAsync(Owner, log, "verify");
        foreach (var phone in new[] { Owner, Mukadam })
        {
            InPull((await PullAsync(phone)).Root, task)!.Value.GetProperty("confirmationState").GetString().Should().Be("Confirmed", $"{phone} before the edit");
        }

        return task;
    }

    /// <summary>Both phones' next pull carries the task, still Done, with the word the log now deserves: Waiting.</summary>
    private async Task AssertResentAsWaitingAsync(Guid task, DateTime cursor, string door)
    {
        foreach (var phone in new[] { Owner, Mukadam })
        {
            var dto = InPull((await PullAsync(phone, cursor)).Root, task);
            dto.Should().NotBeNull($"{door} took the linked log off Verified, so the task must be sent again to {phone}");
            dto!.Value.GetProperty("confirmationState").GetString().Should().Be("Waiting", $"{phone} after {door}");
            dto.Value.GetProperty("status").GetString().Should().Be("Done", "the bump moves the clock, never the status of the task");
            dto.Value.GetProperty("plots").EnumerateArray().Should().OnlyContain(p => p.GetProperty("status").GetString() == "Done");
        }
    }

    [Fact]
    public async Task Adding_a_task_to_a_confirmed_linked_log_resends_the_task_to_both_phones_as_Waiting_L003()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await LogAsync(Mukadam, PlotA, CycleA);
        var task = await ConfirmedTaskAsync(log);
        var cursor = await CursorAfterNowAsync();
        InPull((await PullAsync(Mukadam, cursor)).Root, task).Should().BeNull("nothing changed yet");

        var door = await PushAsync(Mukadam, "add_log_task", $"pw-addtask-{log:N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["logTaskId"] = Guid.NewGuid(),
            ["activityType"] = "spray",
            ["notes"] = "एक फवारणी आणखी",
        });
        door.Status.Should().Be("applied", $"{door.ErrorCode}: {door.ErrorMessage}");
        await AssertResentAsWaitingAsync(task, cursor, "add_log_task");
    }

    [Fact]
    public async Task Moving_a_confirmed_linked_log_to_another_day_resends_the_task_to_both_phones_as_Waiting_L003()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await LogAsync(Mukadam, PlotA, CycleA, details: true);
        var task = await ConfirmedTaskAsync(log);
        var cursor = await CursorAfterNowAsync();

        var door = await PushAsync(Mukadam, "move_daily_log", $"pw-move-{log:N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = 1,
            ["newLogDate"] = "2026-11-07",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        door.Status.Should().Be("applied", $"{door.ErrorCode}: {door.ErrorMessage}");
        await AssertResentAsWaitingAsync(task, cursor, "move_daily_log (MaterialChangeReopen)");
    }

    [Fact]
    public async Task A_material_labour_correction_of_a_confirmed_linked_log_resends_the_task_to_both_phones_as_Waiting_L003()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = await ConfirmedTaskAsync(MukadamLog);
        var cursor = await CursorAfterNowAsync();

        var door = await PushAsync(Owner, "correct_labour_assignment", $"pw-labour-{MukadamLog:N}", new Dictionary<string, object?>
        {
            ["labourAssignmentId"] = MukadamCrew,
            ["dailyLogId"] = MukadamLog,
            ["farmId"] = FarmA,
            ["quantity"] = new Dictionary<string, object?> { ["workerCount"] = 5 },
            ["seen"] = new Dictionary<string, object?> { ["workerCount"] = 8 },
            ["reason"] = "गणती चुकली",
            ["correctedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        door.Status.Should().Be("applied", $"{door.ErrorCode}: {door.ErrorMessage}");
        await AssertResentAsWaitingAsync(task, cursor, "correct_labour_assignment");
    }

    // ── L008: reopen does not leak the task ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Reopen_by_a_seat_that_cannot_see_the_task_answers_not_found_like_a_made_up_id_and_by_a_seat_that_sees_it_Forbidden_L008()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = await HandOutAsync(Mukadam, [PlotA], "Plot");
        var log = await LogAsync(Mukadam, PlotA, CycleA);
        (await CompleteAsync(Mukadam, task, [PlotA], [log])).Status.Should().Be("applied");

        var hidden = await ReopenAsync(Worker2, task, "काम नीट नाही");
        var madeUp = await ReopenAsync(Worker2, Guid.NewGuid(), "काम नीट नाही");
        hidden.Status.Should().Be("failed");
        hidden.ErrorCode.Should().Be("ShramSafal.PlannedWorkNotFound");
        madeUp.ErrorCode.Should().Be(hidden.ErrorCode);
        madeUp.ErrorMessage.Should().Be(hidden.ErrorMessage, "the two answers are identical: no id leak");

        var sees = await ReopenAsync(Mukadam, task, "काम नीट नाही");
        sees.Status.Should().Be("failed");
        sees.ErrorCode.Should().Be("ShramSafal.Forbidden", "he sees the task but only the primary owner reopens it");
        (await RowAsync(task))!.Status.Should().Be("Done");
    }

    [Fact]
    public async Task No_job_card_cost_attendance_or_labour_row_is_written_by_any_plannedwork_step_or_by_confirming_the_linked_log()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Sugarcane");

        // A control: confirming a log that NO task links. Whatever that changes, confirming a linked log may change no more.
        var control = await LogAsync(Mukadam, PlotA, CycleA);
        var beforeControl = await MoneyAndLabourRowsAsync();
        await DecideAsync(Owner, control, "verify");
        var controlDelta = Delta(beforeControl, await MoneyAndLabourRowsAsync());

        var task = await HandOutAsync(Mukadam, [PlotA, plot2], "MultiPlot");
        var logA = await LogAsync(Mukadam, PlotA, CycleA);
        var logB = await LogAsync(Mukadam, plot2, cycle2);
        var before = await MoneyAndLabourRowsAsync();
        before.Keys.Should().Contain(k => k.Contains("job_card") || k.Contains("cost") || k.Contains("attendance") || k.Contains("labour"),
            "the sweep reads the tables it claims to");

        (await CompleteAsync(Mukadam, task, [PlotA], [logA])).Status.Should().Be("applied");
        (await CompleteAsync(Mukadam, task, [plot2], [logB], left: true)).Status.Should().Be("applied");
        (await CompleteAsync(Mukadam, task, [], [logB])).Status.Should().Be("applied");
        (await ReopenAsync(Owner, task, "पुन्हा करा")).Status.Should().Be("applied");
        (await CompleteAsync(Mukadam, task, [PlotA, plot2], [logA, logB])).Status.Should().Be("applied");
        var reminder = Guid.NewGuid();
        await MadeAsync(Mukadam, reminder, assignee: null, plots: [PlotA], scope: "Plot");
        (await CompleteAsync(Mukadam, reminder, [PlotA], [])).Status.Should().Be("applied");
        Delta(before, await MoneyAndLabourRowsAsync()).Should().BeEmpty("no planned-work step writes any of those rows");

        // Confirming and doubting the linked logs.
        var beforeConfirm = await MoneyAndLabourRowsAsync();
        await DecideAsync(Owner, logA, "verify");
        await DecideAsync(Owner, logB, "dispute", "शंका");
        Delta(beforeConfirm, await MoneyAndLabourRowsAsync()).Should().BeEquivalentTo(controlDelta,
            "confirming a linked log changes exactly what confirming any other log changes");
    }

    [Fact]
    public async Task A_replay_of_complete_by_request_id_is_duplicate_and_an_edit_cannot_take_a_done_plot_off()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Sugarcane");
        var (plot3, _) = await SeedSeasonAsync("Onion");
        var task = await HandOutAsync(Mukadam, [PlotA, plot2], "MultiPlot");
        var logA = await LogAsync(Mukadam, PlotA, CycleA);

        var payload = new Dictionary<string, object?>
        {
            ["plannedWorkId"] = task,
            ["farmId"] = FarmA,
            ["plotIds"] = new[] { PlotA },
            ["dailyLogIds"] = new[] { logA },
            ["somethingLeft"] = false,
        };
        (await PushAsync(Mukadam, "plannedwork.complete", "pw-replay-complete", payload)).Status.Should().Be("applied");
        (await PushAsync(Mukadam, "plannedwork.complete", "pw-replay-complete", payload)).Status.Should().Be("duplicate");

        // PlotA is Done: an edit that drops it is refused (the work was done there); one that keeps it is fine.
        var dropped = await EditAsync(Owner, task, assignee: Mukadam, plots: [plot2, plot3], scope: "MultiPlot");
        dropped.Status.Should().Be("failed");
        dropped.ErrorCode.Should().Be("ShramSafal.PlannedWorkState.InvalidCommand");
        var kept = await EditAsync(Owner, task, assignee: Mukadam, plots: [PlotA, plot2, plot3], scope: "MultiPlot");
        kept.Status.Should().Be("applied", $"{kept.ErrorCode}: {kept.ErrorMessage}");
        (await PlotsOfAsync(task)).Single(p => p.Id == PlotA).Status.Should().Be("Done");
        cycle2.Should().NotBeEmpty();
    }

    // ── what the sweep reads ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Row counts of every table in ssf that is about job cards, cost, money, attendance or labour.</summary>
    private async Task<Dictionary<string, long>> MoneyAndLabourRowsAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        var tables = new List<string>();
        await using (var list = db.CreateCommand())
        {
            list.CommandText = """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'ssf' AND table_type = 'BASE TABLE'
                  AND (table_name ~ 'job_card|cost|attendance|labour|wage|payment|ledger|settle|finance|allocation|money')
                ORDER BY table_name
                """;
            await using var reader = await list.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                tables.Add(reader.GetString(0));
            }
        }

        var counts = new Dictionary<string, long>();
        foreach (var table in tables)
        {
            await using var count = db.CreateCommand();
            count.CommandText = $"SELECT count(*) FROM ssf.\"{table}\"";
            counts[table] = Convert.ToInt64(await count.ExecuteScalarAsync());
        }

        return counts;
    }

    private static Dictionary<string, long> Delta(Dictionary<string, long> before, Dictionary<string, long> after) =>
        after.Where(kv => kv.Value != before.GetValueOrDefault(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value - before.GetValueOrDefault(kv.Key));
}
