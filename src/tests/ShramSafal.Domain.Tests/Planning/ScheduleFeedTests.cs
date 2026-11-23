// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
using System;
using System.Collections.Generic;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleFeedTests
{
    private static readonly FarmId Farm = new(Guid.Parse("7b000000-0000-4000-8000-000000000001"));
    private static readonly Guid Plot = Guid.Parse("7b000000-0000-4000-8000-000000000002");
    private static readonly Guid Cycle = Guid.Parse("7b000000-0000-4000-8000-000000000003");
    private static readonly Guid Owner = Guid.Parse("7b000000-0000-4000-8000-000000000011");
    private static readonly Guid Item = OwnScheduleItem.IdFor(Cycle, "sign1");
    private static readonly DateOnly Start = new(2026, 10, 15);
    private static readonly DateTime At = new(2026, 11, 23, 6, 0, 0, DateTimeKind.Utc);

    private static PlannedWork Plan(ScheduleResolution resolution, int occurrence = 1, ScheduleSignAnswer? answer = null) =>
        PlannedWork.CreateFromSchedule(
            PlannedWork.ScheduleIdFor(Item, occurrence), Farm, "फुलोरा फवारणी", Plot, null, null, Item, "sign1", occurrence, resolution, answer,
            DateOnly.FromDateTime(At), Owner, At);

    private static ScheduleTaskEvent Answer(ScheduleSignAnswer answer, DateOnly on, int minute) =>
        ScheduleTaskEvent.Create(Guid.NewGuid(), Farm, Plot, Cycle, Item, "sign1", answer, on, Owner, At.AddMinutes(minute), out _)!;

    private static readonly Dictionary<string, ScheduleTaskTiming> SignAt10 = new() { ["sign1"] = ScheduleTaskTiming.WhenSeen("फुले दिसली", 10, 10) };

    [Fact]
    public void PlanFromMine_LinksItem_ByKeyAndItem_NeverByStepId_AndIsAScheduleSource()
    {
        var plan = Plan(ScheduleTimerResolver.Resolve("sign1", SignAt10, Start));

        plan.OwnItemId.Should().Be(Item);
        plan.ScheduleTaskKey.Should().Be("sign1");
        plan.Occurrence.Should().Be(1);
        plan.Source.Should().Be(PlannedWorkSource.Schedule);
        plan.SourcePlotId.Should().Be(Plot);
        plan.Id.Should().Be(PlannedWork.ScheduleIdFor(Item, 1), "two phones mint the same id for the same occurrence");
        PlannedWork.ScheduleIdFor(Item, 2).Should().NotBe(plan.Id);
    }

    [Fact]
    public void The_plan_id_of_an_occurrence_is_the_same_UUIDv5_the_phone_mints()
    {
        // The phone's half: scheduleFeedIds.ts (uuid v5 of "<ownItemId>:<occurrence>" under the same namespace); vectors computed with the uuid package.
        var item = Guid.Parse("7b000000-0000-4000-8000-0000000000aa");
        PlannedWork.ScheduleIdFor(item, 1).Should().Be(Guid.Parse("abdfa4d1-3ad8-5207-a643-ae6e1991fa6b"));
        PlannedWork.ScheduleIdFor(item, 2).Should().Be(Guid.Parse("aebcdb70-09ce-5ca6-8be6-ad4fafd629b1"));
    }

    [Fact]
    public void WhenSeen_Unseen_IsAWaitingPlan_WithTheExpectationKept()
    {
        var plan = Plan(ScheduleTimerResolver.Resolve("sign1", SignAt10, Start));

        plan.IsWaiting.Should().BeTrue();
        plan.PlannedDate.Should().BeNull();
        plan.ExpectedFrom.Should().Be(Start.AddDays(10));
        plan.Status.Should().Be(PlannedWorkStatus.Open, "a waiting plan is open work, never late, never done");
        plan.IsLate(Start.AddDays(40)).Should().BeFalse();
    }

    [Fact]
    public void SignOnDay5_MovesPlanToDay5_KeepsExpected10()
    {
        var plan = Plan(ScheduleTimerResolver.Resolve("sign1", SignAt10, Start));
        var events = new[] { Answer(ScheduleSignAnswer.Seen, Start.AddDays(5), 1) };
        var facts = new Dictionary<string, ScheduleTaskFacts> { ["sign1"] = new(SignSeenOn: ScheduleSignFacts.SeenOn(events)) };

        plan.FollowSchedule(ScheduleTimerResolver.Resolve("sign1", SignAt10, Start, facts), ScheduleSignFacts.LatestAnswer(events), At.AddHours(1))
            .Should().BeTrue();

        plan.PlannedDate.Should().Be(Start.AddDays(5));
        plan.ExpectedFrom.Should().Be(Start.AddDays(10), "expected and actual are both kept");
        plan.SignAnswer.Should().Be(ScheduleSignAnswer.Seen);
        plan.Status.Should().Be(PlannedWorkStatus.Open, "a sign seen is not the work done");
    }

    [Fact]
    public void Latest_decisive_answer_wins_and_unsure_moves_nothing()
    {
        var seen = Answer(ScheduleSignAnswer.Seen, Start.AddDays(5), 1);
        var unsure = Answer(ScheduleSignAnswer.Unsure, Start.AddDays(6), 2);
        var notYet = Answer(ScheduleSignAnswer.NotYet, Start.AddDays(7), 3);

        ScheduleSignFacts.SeenOn([seen, unsure]).Should().Be(Start.AddDays(5));
        ScheduleSignFacts.LatestAnswer([seen, unsure]).Should().Be(ScheduleSignAnswer.Unsure);
        ScheduleSignFacts.SeenOn([seen, unsure, notYet]).Should().BeNull("a later 'not yet' takes the seen back");
        ScheduleSignFacts.SeenOn([unsure]).Should().BeNull("unsure is never seen");
        ScheduleSignFacts.SeenOn([]).Should().BeNull("no answer is never seen");
    }

    [Fact]
    public void A_day_chosen_by_hand_survives_a_recompute_that_changed_nothing_but_a_real_event_moves_it()
    {
        var timings = new Dictionary<string, ScheduleTaskTiming> { ["sign1"] = ScheduleTaskTiming.OnDays(20) };
        var plan = Plan(ScheduleTimerResolver.Resolve("sign1", timings, Start));
        plan.PlannedDate.Should().Be(Start.AddDays(20));

        plan.Edit(new PlannedWorkDetails("फुलोरा फवारणी", PlannedWorkScope.Plot, [Plot], Start.AddDays(23), null, null, null, null, null, null, null, null), At);
        plan.FollowSchedule(ScheduleTimerResolver.Resolve("sign1", timings, Start), null, At.AddHours(1)).Should().BeFalse();
        plan.PlannedDate.Should().Be(Start.AddDays(23), "the farmer's postponement is his; the schedule did not change");

        var moved = new Dictionary<string, ScheduleTaskTiming> { ["sign1"] = ScheduleTaskTiming.OnDays(25) };
        plan.FollowSchedule(ScheduleTimerResolver.Resolve("sign1", moved, Start), null, At.AddHours(2)).Should().BeTrue();
        plan.PlannedDate.Should().Be(Start.AddDays(25));
    }

    [Fact]
    public void A_follower_returns_to_waiting_with_its_expectation_when_the_record_it_followed_is_taken_back()
    {
        var timings = new Dictionary<string, ScheduleTaskTiming>
        {
            ["first"] = ScheduleTaskTiming.OnDays(10),
            ["sign1"] = ScheduleTaskTiming.AfterTask("first", usualDays: 7),
        };
        var recorded = new Dictionary<string, ScheduleTaskFacts> { ["first"] = new(ActualDate: Start.AddDays(12)) };
        var plan = Plan(ScheduleTimerResolver.Resolve("sign1", timings, Start, recorded));
        plan.PlannedDate.Should().Be(Start.AddDays(19), "after follows what was recorded");
        plan.ExpectedFrom.Should().Be(Start.AddDays(17));

        plan.FollowSchedule(ScheduleTimerResolver.Resolve("sign1", timings, Start), null, At.AddHours(1)).Should().BeTrue();
        plan.IsWaiting.Should().BeTrue("with no record there is only an expectation");
        plan.ExpectedFrom.Should().Be(Start.AddDays(17));
    }

    [Fact]
    public void Two_works_after_each_other_in_a_loop_make_a_waiting_plan_and_never_throw()
    {
        // The maker (slice 4) lets A be after B and B after A: planning from it must wait, never recurse forever, never throw.
        var timings = new Dictionary<string, ScheduleTaskTiming>
        {
            ["sign1"] = ScheduleTaskTiming.AfterTask("other", usualDays: 2),
            ["other"] = ScheduleTaskTiming.AfterTask("sign1", usualDays: 3),
        };
        var plan = Plan(ScheduleTimerResolver.Resolve("sign1", timings, Start));
        plan.IsWaiting.Should().BeTrue();
        plan.ExpectedFrom.Should().BeNull();
        plan.FollowSchedule(ScheduleTimerResolver.Resolve("sign1", timings, Start), null, At.AddHours(1)).Should().BeFalse();
    }

    [Fact]
    public void A_closed_plan_never_follows_the_schedule()
    {
        var plan = Plan(ScheduleTimerResolver.Resolve("sign1", SignAt10, Start));
        plan.Cancel(Owner, null, At);
        var facts = new Dictionary<string, ScheduleTaskFacts> { ["sign1"] = new(SignSeenOn: Start.AddDays(5)) };

        plan.FollowSchedule(ScheduleTimerResolver.Resolve("sign1", SignAt10, Start, facts), ScheduleSignAnswer.Seen, At.AddHours(1)).Should().BeFalse();
        plan.PlannedDate.Should().BeNull();
    }

    [Fact]
    public void A_repeating_work_moves_each_occurrence_by_its_spacing_and_stops_at_its_end()
    {
        var timing = ScheduleTaskTiming.OnDays(10, 30).Repeating(ScheduleRepeatMode.EveryNDays, 7);
        var first = ScheduleTimerResolver.Resolve("r", new Dictionary<string, ScheduleTaskTiming> { ["r"] = timing }, Start);

        ScheduleOccurrences.For(first, timing, 1).Due!.From.Should().Be(Start.AddDays(10));
        ScheduleOccurrences.For(first, timing, 3).Due!.From.Should().Be(Start.AddDays(24));
        ScheduleOccurrences.IsPastEnd(ScheduleOccurrences.For(first, timing, 3), timing, Start).Should().BeFalse();
        ScheduleOccurrences.IsPastEnd(ScheduleOccurrences.For(first, timing, 4), timing, Start).Should().BeTrue("day 31 is after the window's last day 30");
        ScheduleOccurrences.Spacing(ScheduleTaskTiming.OnDays(1).Repeating(ScheduleRepeatMode.PerWeek, 2)).Should().Be(3);
        ScheduleOccurrences.Spacing(ScheduleTaskTiming.OnDays(1)).Should().Be(0);
    }

    [Fact]
    public void An_answer_needs_its_parts()
    {
        ScheduleTaskEvent.Create(Guid.Empty, Farm, Plot, Cycle, Item, "sign1", ScheduleSignAnswer.Seen, Start, Owner, At, out var p1).Should().BeNull();
        p1.Should().NotBeNull();
        ScheduleTaskEvent.Create(Guid.NewGuid(), Farm, Plot, Cycle, Item, "not a key!", ScheduleSignAnswer.Seen, Start, Owner, At, out var p2).Should().BeNull();
        p2.Should().NotBeNull();
        ScheduleSignAnswers.TryParse("not_yet", out var a).Should().BeTrue();
        a.Should().Be(ScheduleSignAnswer.NotYet);
        ScheduleSignAnswers.TryParse("2", out _).Should().BeFalse("never a number");
        ScheduleSignAnswers.ToWire(ScheduleSignAnswer.Unsure).Should().Be("unsure");
    }
}
