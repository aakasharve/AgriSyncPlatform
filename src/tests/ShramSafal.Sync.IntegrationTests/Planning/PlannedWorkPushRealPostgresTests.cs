// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 Task 3 (founder D-24 / D-24c / D-24a, D-26, D-29; E4, P10).
//
// The five queued doors (plannedwork.create / edit / seen / accept / cancel) through the real push handler, on a real Postgres
// as agrisync_app (E3 first, in every fact): the whole life of a task; a replay is a no-op; the cancel-vs-accept race has one
// winner; the assignee must be an Active member covering the plots; every plot must belong to the farm named (a foreign plot
// answers like an unknown one); who may make, change and cancel; and a headcount, quantity or pay choice creates nothing.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlannedWorkPushRealPostgresTests(ITestOutputHelper output) : PlannedWorkLane(output)
{
    [Fact]
    public async Task Create_edit_seen_accept_cancel_through_push_keep_the_whole_life_of_a_task()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();

        var created = await MadeAsync(Owner, task, assignee: Mukadam, crew: "मुकादम आणि ५ बायका", headcount: 6);
        created.Status.Should().Be("applied");
        var row = (await RowAsync(task))!;
        row.Status.Should().Be("Assigned");
        row.CreatedBy.Should().Be(Owner, "the maker is the token's user");
        row.Assignee.Should().Be(Mukadam);
        row.Farm.Should().Be(FarmA);
        row.Scope.Should().Be("Plot");

        (await StepAsync(Mukadam, "seen", task)).Status.Should().Be("applied");
        (await RowAsync(task))!.Status.Should().Be("Seen");
        (await RowAsync(task))!.SeenAt.Should().NotBeNull();
        (await StepAsync(Mukadam, "accept", task)).Status.Should().Be("applied");
        (await RowAsync(task))!.Status.Should().Be("Accepted");
        (await RowAsync(task))!.AcceptedAt.Should().NotBeNull();

        var edited = await EditAsync(Owner, task, assignee: Mukadam, title: "द्राक्षाला दुसरी फवारणी");
        edited.Status.Should().Be("applied", $"{edited.ErrorCode}: {edited.ErrorMessage}");
        (await RowAsync(task))!.Title.Should().Be("द्राक्षाला दुसरी फवारणी");
        (await RowAsync(task))!.Status.Should().Be("Accepted", "the same assignee keeps his answer");

        var cancelled = await StepAsync(Owner, "cancel", task, reason: "पाऊस आला");
        cancelled.Status.Should().Be("applied", $"{cancelled.ErrorCode}: {cancelled.ErrorMessage}");
        var done = (await RowAsync(task))!;
        done.Status.Should().Be("Cancelled");
        done.CancelledBy.Should().Be(Owner);
        (await TaskCountAsync()).Should().Be(1, "cancelling keeps the task");

        // The farm-local day it was made, as a day (D-29).
        done.RecordedOn.Should().MatchRegex(@"^\d{4}-\d{2}-\d{2}$");
    }

    [Fact]
    public async Task Replayed_clientCommandId_is_a_noop()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        var payload = TaskPayload(task, FarmA, plots: [PlotA]);

        var first = await PushAsync(Owner, "plannedwork.create", "pw-replay-1", payload);
        first.Status.Should().Be("applied", $"{first.ErrorCode}: {first.ErrorMessage}");
        var again = await PushAsync(Owner, "plannedwork.create", "pw-replay-1", payload);
        again.Status.Should().Be("duplicate", "the same request again is answered from what was kept, not applied twice");
        (await TaskCountAsync()).Should().Be(1);

        // The same task id by the same maker under a NEW request id is the task already kept - no second row, no second audit row.
        var resent = await PushAsync(Owner, "plannedwork.create", "pw-replay-2", payload);
        resent.Status.Should().Be("applied");
        (await TaskCountAsync()).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'PlannedWork' AND entity_id = @id", ("id", task)))
            .Should().Be(1);

        // Another person cannot take the id over.
        var stolen = await PushAsync(Mukadam, "plannedwork.create", "pw-replay-3", payload);
        stolen.Status.Should().Be("failed");
        (await RowAsync(task))!.CreatedBy.Should().Be(Owner);
    }

    [Fact]
    public async Task Concurrent_cancel_vs_accept_one_wins_the_other_gets_a_conflict()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam);

        // The race itself: two phones' requests load the same row, then both save. The row version (xmin) lets one win.
        await using (var first = NewSuperuserContext())
        await using (var second = NewSuperuserContext())
        {
            var byOwner = await first.PlannedWork.Include(w => w.Plots).SingleAsync(w => w.Id == task);
            var byMukadam = await second.PlannedWork.Include(w => w.Plots).SingleAsync(w => w.Id == task);
            byOwner.Cancel(Owner, "रद्द", DateTime.UtcNow).Should().Be(PlannedWorkStep.Applied);
            byMukadam.Accept(Mukadam, DateTime.UtcNow).Should().Be(PlannedWorkStep.Applied);

            await first.SaveChangesAsync();
            var loser = async () => await second.SaveChangesAsync();
            await loser.Should().ThrowAsync<DbUpdateConcurrencyException>("the second writer lost the race");
        }

        var row = (await RowAsync(task))!;
        row.Status.Should().Be("Cancelled", "one wins");
        row.AcceptedAt.Should().BeNull("the other left nothing behind");

        // The same race one step later, through the door: the accept that arrives after the cancel is refused, visibly (P10).
        var late = await StepAsync(Mukadam, "accept", task);
        late.Status.Should().Be("failed");
        late.ErrorCode.Should().Be("ShramSafal.PlannedWorkState.InvalidCommand");
        (await RowAsync(task))!.AcceptedAt.Should().BeNull();
        // …and a cancel after an accept is refused the same way when the task is Done (L8c-3); here a second cancel is the same task.
        (await StepAsync(Owner, "cancel", task)).Status.Should().Be("applied", "a second cancel changes nothing");
    }

    [Fact]
    public async Task AssigneeNotMember_is_refused_permanently()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var (who, label) in new[] { (Paused, "paused"), (OwnerB, "another farm's owner"), (Guid.NewGuid(), "a made-up person") })
        {
            var refused = await MakeAsync(Owner, Guid.NewGuid(), assignee: who);
            refused.Status.Should().Be("failed", label);
            refused.ErrorCode.Should().Be("ShramSafal.PlannedWorkAssigneeNotMember.InvalidCommand", label);
            refused.ErrorCode.Should().EndWith(".InvalidCommand", "every phone in the field parks a code ending so (P10)");
        }

        (await TaskCountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task AssigneeOutsidePlots_is_refused_permanently()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        await SetChosenPlotsAsync(Mukadam, plot2);

        var refused = await MakeAsync(Owner, Guid.NewGuid(), assignee: Mukadam, plots: [PlotA]);
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be("ShramSafal.PlannedWorkAssigneeOutsidePlots.InvalidCommand");

        // Not vacuous: on his own plot he is given the work; a Farm task (no plot) needs no cover.
        (await MakeAsync(Owner, Guid.NewGuid(), assignee: Mukadam, plots: [plot2])).Status.Should().Be("applied");
        (await MakeAsync(Owner, Guid.NewGuid(), assignee: Mukadam, scope: "Farm")).Status.Should().Be("applied");
        // A multi-plot task needs him to cover every plot.
        (await MakeAsync(Owner, Guid.NewGuid(), assignee: Mukadam, plots: [PlotA, plot2], scope: "MultiPlot")).ErrorCode
            .Should().Be("ShramSafal.PlannedWorkAssigneeOutsidePlots.InvalidCommand");
    }

    [Fact]
    public async Task A_plot_of_another_farm_with_this_farm_id_is_refused_like_an_unknown_plot()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Ramesh owns farm B (every authority THERE). He names his own farm B with farm A's plot: the plot must belong to the
        // farm named, and the authority is asked on that farm - never on the farm id alone (E4, L8b-1 fix round 1 H1).
        var withForeignPlot = await MakeAsync(OwnerB, Guid.NewGuid(), plots: [PlotA], farm: FarmB);
        var withMadeUpPlot = await MakeAsync(OwnerB, Guid.NewGuid(), plots: [Guid.NewGuid()], farm: FarmB);
        withForeignPlot.Status.Should().Be("failed");
        withForeignPlot.ErrorCode.Should().Be("ShramSafal.PlotNotFound");
        withForeignPlot.ErrorCode.Should().Be(withMadeUpPlot.ErrorCode, "answered exactly as an unknown plot");
        withForeignPlot.ErrorMessage.Should().Be(withMadeUpPlot.ErrorMessage);
        (await TaskCountAsync()).Should().Be(0, "nothing of farm A changed and nothing was made");

        // Not vacuous: the same door on his own plot works, and farm A's owner on farm A's plot works.
        (await MakeAsync(OwnerB, Guid.NewGuid(), plots: [PlotB], farm: FarmB)).Status.Should().Be("applied");
        (await MakeAsync(Owner, Guid.NewGuid(), plots: [PlotA])).Status.Should().Be("applied");

        // A task id of farm A named under farm B is "not found" on every step, like a made-up id.
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam);
        foreach (var verb in new[] { "seen", "accept", "cancel" })
        {
            var foreign = await StepAsync(OwnerB, verb, task, farm: FarmB);
            var fake = await StepAsync(OwnerB, verb, Guid.NewGuid(), farm: FarmB);
            foreign.Status.Should().Be("failed", verb);
            foreign.ErrorCode.Should().Be(fake.ErrorCode, verb);
        }

        var foreignEdit = await EditAsync(OwnerB, task, assignee: null, farm: FarmB, plots: [PlotB]);
        foreignEdit.ErrorCode.Should().Be("ShramSafal.PlannedWorkNotFound");
        (await RowAsync(task))!.Status.Should().Be("Assigned", "farm A's task is untouched");
        (await RowAsync(task))!.Title.Should().Be("द्राक्षाला फवारणी");
    }

    [Fact]
    public async Task A_caller_without_the_authority_naming_another_farms_plot_gets_the_not_found_answer_L003()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var madeUp = await MakeAsync(Worker, Guid.NewGuid(), assignee: Worker2, plots: [Guid.NewGuid()]);
        var foreign = await MakeAsync(Worker, Guid.NewGuid(), assignee: Worker2, plots: [PlotB]);
        madeUp.ErrorCode.Should().Be("ShramSafal.PlotNotFound", "the plot check runs before any authority is asked");
        foreign.ErrorCode.Should().Be(madeUp.ErrorCode, "another farm's plot answers like a made-up one, not Forbidden");
        foreign.ErrorMessage.Should().Be(madeUp.ErrorMessage);

        // The same on edit: a worker who may see the task (assignee) but may not change it.
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Worker);
        var editForeign = await EditAsync(Worker, task, assignee: Worker, plots: [PlotB]);
        var editMadeUp = await EditAsync(Worker, task, assignee: Worker, plots: [Guid.NewGuid()]);
        editForeign.ErrorCode.Should().Be("ShramSafal.PlotNotFound");
        editForeign.ErrorCode.Should().Be(editMadeUp.ErrorCode);
        // Not vacuous: with a real plot of this farm the same caller is refused for what he lacks.
        (await MakeAsync(Worker, Guid.NewGuid(), assignee: Worker2)).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await EditAsync(Worker, task, assignee: Worker, plots: [PlotA])).ErrorCode.Should().Be("ShramSafal.Forbidden");
    }

    [Fact]
    public async Task Who_may_make_change_and_cancel_follows_the_farm_seat_never_a_label()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A personal reminder grants no authority: a कामगार makes one; giving work to someone else needs AssignWork.
        (await MakeAsync(Worker, Guid.NewGuid())).Status.Should().Be("applied");
        (await MakeAsync(Worker, Guid.NewGuid(), assignee: Worker)).Status.Should().Be("applied", "assigned to himself is a reminder");
        var forbidden = await MakeAsync(Worker, Guid.NewGuid(), assignee: Worker2);
        forbidden.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await MakeAsync(Mukadam, Guid.NewGuid(), assignee: Worker)).ErrorCode.Should().Be("ShramSafal.Forbidden", "a मुकादम label grants nothing");
        (await MakeAsync(CoOwner, Guid.NewGuid(), assignee: Worker)).ErrorCode.Should().Be("ShramSafal.Forbidden", "nor does सहमालक");
        (await MakeAsync(Paused, Guid.NewGuid())).ErrorCode.Should().Be("ShramSafal.Forbidden", "a paused seat makes nothing");

        await GrantAsync(Mukadam, FarmAuthority.AssignWork);
        var assigned = Guid.NewGuid();
        (await MakeAsync(Mukadam, assigned, assignee: Worker)).Status.Should().Be("applied", "AssignWork is held");

        // Changing or cancelling someone else's task: PlanWork or the primary owner.
        var ownersTask = Guid.NewGuid();
        await MadeAsync(Owner, ownersTask, assignee: Worker);
        (await EditAsync(CoOwner, ownersTask, assignee: Worker)).ErrorCode.Should().Be("ShramSafal.PlannedWorkNotFound", "he cannot even see it");
        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks);
        (await EditAsync(CoOwner, ownersTask, assignee: Worker)).ErrorCode.Should().Be("ShramSafal.Forbidden", "seeing is not planning");
        (await StepAsync(CoOwner, "cancel", ownersTask)).ErrorCode.Should().Be("ShramSafal.Forbidden");
        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks, FarmAuthority.PlanWork);
        (await EditAsync(CoOwner, ownersTask, assignee: Worker, title: "सहमालकाने बदलले")).Status.Should().Be("applied");
        (await EditAsync(CoOwner, ownersTask, assignee: Worker2)).ErrorCode.Should().Be("ShramSafal.Forbidden", "moving it to another person also needs AssignWork");
        (await StepAsync(CoOwner, "cancel", ownersTask)).Status.Should().Be("applied");

        // The maker keeps what he made only while he still holds what he used: Mukadam lost AssignWork.
        await GrantAsync(Mukadam);
        (await StepAsync(Mukadam, "cancel", assigned)).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await RowAsync(assigned))!.Status.Should().Be("Assigned");
        // His own reminder is always his.
        var reminder = Guid.NewGuid();
        await MadeAsync(Mukadam, reminder);
        (await StepAsync(Mukadam, "cancel", reminder)).Status.Should().Be("applied");

        // Seen and accept: the assignee only.
        var forWorker = Guid.NewGuid();
        await MadeAsync(Owner, forWorker, assignee: Worker);
        (await StepAsync(Worker2, "accept", forWorker)).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await StepAsync(Owner, "seen", forWorker)).ErrorCode.Should().Be("ShramSafal.Forbidden", "not even the primary owner answers for him");
        (await StepAsync(Worker, "accept", forWorker)).Status.Should().Be("applied");
    }

    [Fact]
    public async Task A_headcount_quantity_or_pay_choice_creates_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        string[] tables =
        [
            "ssf.attendance_marks", "ssf.cost_entries", "ssf.job_cards", "ssf.day_ledgers", "ssf.daily_logs",
            "ssf.labour_assignments", "ssf.finance_corrections",
        ];
        var before = new List<long>();
        foreach (var table in tables)
        {
            before.Add(await CountAsync($"SELECT count(*) FROM {table}"));
        }

        var task = Guid.NewGuid();
        var created = await MakeAsync(Owner, task, assignee: Mukadam, crew: "मुकादम आणि १० बायका", headcount: 11, payMode: "Daily", quantity: "२ एकर");
        created.Status.Should().Be("applied", $"{created.ErrorCode}: {created.ErrorMessage}");
        (await StepAsync(Mukadam, "accept", task)).Status.Should().Be("applied");

        for (var i = 0; i < tables.Length; i++)
        {
            (await CountAsync($"SELECT count(*) FROM {tables[i]}")).Should().Be(before[i], $"{tables[i]} is not touched by planned work");
        }

        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE expected_headcount = 11 AND pay_mode = 'Daily' AND quantity_text = '२ एकर'"))
            .Should().Be(1, "the words are kept as said");
    }

    [Fact]
    public async Task A_payload_the_record_forbids_is_refused_and_nothing_is_made()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var id = Guid.NewGuid();
        var unknownField = TaskPayload(id, FarmA, plots: [PlotA]);
        unknownField["createdByUserId"] = Mukadam;
        (await PushAsync(Owner, "plannedwork.create", "pw-bad-1", unknownField)).ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");

        var crewWithoutPerson = TaskPayload(id, FarmA, plots: [PlotA], crew: "मुकादम", headcount: 3);
        (await PushAsync(Owner, "plannedwork.create", "pw-bad-2", crewWithoutPerson)).ErrorCode.Should().Be("ShramSafal.PlannedWork.InvalidCommand");

        var twoPlotsForOne = TaskPayload(id, FarmA, plots: [PlotA, Guid.NewGuid()], scope: "Plot");
        (await PushAsync(Owner, "plannedwork.create", "pw-bad-3", twoPlotsForOne)).Status.Should().Be("failed");

        var dateAndLoose = TaskPayload(id, FarmA, plots: [PlotA], plannedDate: "2026-12-01");
        dateAndLoose["looseWhen"] = "Week";
        (await PushAsync(Owner, "plannedwork.create", "pw-bad-4", dateAndLoose)).ErrorCode.Should().Be("ShramSafal.PlannedWork.InvalidCommand");

        var farAway = TaskPayload(id, FarmA, plots: [PlotA]);
        farAway["recordedOn"] = "2025-01-01";
        (await PushAsync(Owner, "plannedwork.create", "pw-bad-5", farAway)).ErrorCode.Should().Be("ShramSafal.PlannedWork.InvalidCommand");

        var badWord = TaskPayload(id, FarmA, plots: [PlotA]);
        badWord["payMode"] = "Bitcoin";
        (await PushAsync(Owner, "plannedwork.create", "pw-bad-6", badWord)).ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");

        (await TaskCountAsync()).Should().Be(0);

        // Undated and a stated day within range are fine; the farm-local day is the default (D-29).
        var fine = TaskPayload(id, FarmA, plots: [PlotA]);
        (await PushAsync(Owner, "plannedwork.create", "pw-fine", fine)).Status.Should().Be("applied");
        var istDay = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(5.5)).ToString("yyyy-MM-dd");
        (await RowAsync(id))!.RecordedOn.Should().Be(istDay);
    }
}
