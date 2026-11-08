// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 Task 5 (founder D-24c "one accountable assignee"; P10, D-26).
//
// Reassign and withdraw, on a real Postgres as agrisync_app (E3 first), through the real host and the real push: reassigning
// sends the task to the new assignee and names a withdrawn id (kind "PlannedWork", nothing else) to the old one; the old
// assignee's later seen / accept is refused (ShramSafal.Forbidden) and parked; nobody who never held the task is told of it;
// the withdrawal is delivered once, with the cursor a phone really sends (whole seconds).
using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlannedWorkReassignRealPostgresTests(ITestOutputHelper output) : PlannedWorkLane(output)
{
    [Fact]
    public async Task Reassigning_sends_the_task_to_the_new_assignee_and_a_withdrawn_id_to_the_old_one()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Worker);

        // Worker's phone pulls it (a clean install) and holds it; then the cursor moves on.
        PlannedIds((await PullAsync(Worker)).Root).Should().Contain(task);
        var cursor = await CursorAfterNowAsync();

        var reassigned = await EditAsync(Owner, task, assignee: Worker2);
        reassigned.Status.Should().Be("applied", $"{reassigned.ErrorCode}: {reassigned.ErrorMessage}");
        var row = (await RowAsync(task))!;
        row.Assignee.Should().Be(Worker2);
        row.Status.Should().Be("Assigned", "the new assignee starts from the beginning");
        row.Former.Should().Equal(Worker);

        // The new assignee gets the task. (A withdrawal is delivered once the change's whole second is over - PRV's rule - so wait.)
        await Task.Delay(TimeSpan.FromMilliseconds(1100));
        PlannedIds((await PullAsync(Worker2, cursor)).Root).Should().Contain(task);
        // The old one is told to forget it: kind + id and nothing else, and no copy of it.
        var (body, old) = await PullAsync(Worker, cursor);
        Withdrawn(old).Should().Contain(("PlannedWork", task));
        PlannedIds(old).Should().NotContain(task);
        body.Should().NotContain("द्राक्षाला", "none of its words");
        old.GetProperty("nextCursorUtc").GetDateTime().Should().BeAfter(cursor, "the cursor passes the withdrawal, so it is delivered once");

        // Delivered once: a pull from the cursor he was just given says nothing more.
        var next = old.GetProperty("nextCursorUtc").GetDateTime();
        await Task.Delay(TimeSpan.FromMilliseconds(1100));
        Withdrawn((await PullAsync(Worker, next)).Root).Should().NotContain(("PlannedWork", task));

        // Nobody who never held it is told anything; the owner still sees it.
        Withdrawn((await PullAsync(Worker2, cursor)).Root).Should().BeEmpty();
        Withdrawn((await PullAsync(Mukadam, cursor)).Root).Should().BeEmpty();
        Withdrawn((await PullAsync(CoOwner, cursor)).Root).Should().BeEmpty();
        PlannedIds((await PullAsync(Owner, cursor)).Root).Should().Contain(task);
        (await GetAsync(Worker, TaskUrl(task))).Status.Should().Be(System.Net.HttpStatusCode.NotFound, "nor can the old assignee read it by REST");
    }

    [Fact]
    public async Task The_old_assignees_later_seen_and_accept_are_refused_Forbidden_and_parked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Worker);
        (await EditAsync(Owner, task, assignee: Worker2)).Status.Should().Be("applied");

        foreach (var verb in new[] { "seen", "accept" })
        {
            var late = await StepAsync(Worker, verb, task);
            late.Status.Should().Be("failed", verb);
            late.ErrorCode.Should().Be("ShramSafal.Forbidden", $"{verb}: the code every phone parks visibly");
        }

        var row = (await RowAsync(task))!;
        row.Status.Should().Be("Assigned");
        row.SeenAt.Should().BeNull();
        row.AcceptedAt.Should().BeNull("nothing of the old assignee's answer was kept");
        (await StepAsync(Worker2, "accept", task)).Status.Should().Be("applied", "the new assignee answers");
    }

    [Fact]
    public async Task The_old_assignee_on_a_cancelled_task_is_still_Forbidden_L005()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Worker);
        (await EditAsync(Owner, task, assignee: Worker2)).Status.Should().Be("applied");
        (await StepAsync(Owner, "cancel", task)).Status.Should().Be("applied");

        foreach (var verb in new[] { "seen", "accept" })
        {
            var late = await StepAsync(Worker, verb, task);
            late.ErrorCode.Should().Be("ShramSafal.Forbidden", $"{verb}: not his, whatever the state");
        }

        (await StepAsync(Worker2, "accept", task)).ErrorCode.Should().Be("ShramSafal.PlannedWorkState.InvalidCommand", "the real assignee meets the closed state");
    }

    [Fact]
    public async Task Taking_the_work_back_to_a_reminder_withdraws_it_from_the_assignee_too()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Worker);
        PlannedIds((await PullAsync(Worker)).Root).Should().Contain(task);
        var cursor = await CursorAfterNowAsync();

        (await EditAsync(Owner, task, assignee: null)).Status.Should().Be("applied");
        await Task.Delay(TimeSpan.FromMilliseconds(1100));

        (await RowAsync(task))!.Status.Should().Be("Open", "no assignee: a reminder again");
        Withdrawn((await PullAsync(Worker, cursor)).Root).Should().Contain(("PlannedWork", task));
        PlannedIds((await PullAsync(Owner, cursor)).Root).Should().Contain(task);
    }

    /// <summary>The P11 run's input: when <c>L8C1_P11_BODIES</c> names a folder, the bodies this server sent are kept there.</summary>
    private static void Keep(string name, string body)
    {
        var folder = Environment.GetEnvironmentVariable("L8C1_P11_BODIES");
        if (!string.IsNullOrWhiteSpace(folder))
        {
            System.IO.Directory.CreateDirectory(folder);
            System.IO.File.WriteAllText(System.IO.Path.Combine(folder, $"{name}.json"), body);
        }
    }

    [Fact]
    public async Task Pull_bodies_with_the_new_key_and_the_withdrawn_kind_are_kept_for_the_1017_run()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Worker, crew: "मुकादम आणि ५ बायका", headcount: 6);
        var (firstBody, first) = await PullAsync(Worker);
        first.TryGetProperty("plannedWork", out var key).Should().BeTrue("the server sends the key");
        key.GetArrayLength().Should().Be(1);
        Keep("l8c1-new-key", firstBody);
        var cursor = await CursorAfterNowAsync();

        (await EditAsync(Owner, task, assignee: Worker2)).Status.Should().Be("applied");
        await Task.Delay(TimeSpan.FromMilliseconds(1100));

        var (withdrawnBody, withdrawn) = await PullAsync(Worker, cursor);
        Withdrawn(withdrawn).Should().Contain(("PlannedWork", task));
        Keep("l8c1-withdrawn-kind", withdrawnBody);
        var (ownerBody, owner) = await PullAsync(Owner);
        TasksOf(owner).Should().ContainSingle();
        Keep("l8c1-owner-full", ownerBody);
        // A body from a seat with nothing to receive still carries the key (empty), never an absent one.
        var (emptyBody, empty) = await PullAsync(CoOwner);
        empty.TryGetProperty("plannedWork", out var emptyKey).Should().BeTrue();
        emptyKey.GetArrayLength().Should().Be(0);
        Keep("l8c1-empty-key", emptyBody);
    }

    [Fact]
    public async Task A_reassign_to_the_same_person_and_a_plain_edit_withdraw_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Worker);
        PlannedIds((await PullAsync(Worker)).Root).Should().Contain(task);
        var cursor = await CursorAfterNowAsync();

        (await EditAsync(Owner, task, assignee: Worker, title: "द्राक्षाला नवी फवारणी")).Status.Should().Be("applied");

        var (_, worker) = await PullAsync(Worker, cursor);
        Withdrawn(worker).Should().BeEmpty();
        TasksOf(worker).Single().GetProperty("title").GetString().Should().Be("द्राक्षाला नवी फवारणी");
    }
}
