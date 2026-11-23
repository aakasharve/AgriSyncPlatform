// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main")
using System;
using System.Linq;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class OwnScheduleItemTests
{
    private static readonly FarmId Farm = new(Guid.Parse("7a000000-0000-4000-8000-000000000001"));
    private static readonly Guid Plot = Guid.Parse("7a000000-0000-4000-8000-000000000002");
    private static readonly Guid Cycle = Guid.Parse("7a000000-0000-4000-8000-000000000003");
    private static readonly UserId Owner = new(Guid.Parse("7a000000-0000-4000-8000-000000000011"));
    private static readonly UserId Typist = new(Guid.Parse("7a000000-0000-4000-8000-000000000012"));
    private static readonly DateTime At = new(2026, 11, 23, 6, 0, 0, DateTimeKind.Utc);

    private static ScheduleTaskContent Work(string key, ScheduleTaskTiming? timing = null, int stage = 0, string? origin = null, int? reEntry = null) =>
        new(key, "काम " + key, ScheduleTaskKind.Work, timing ?? ScheduleTaskTiming.OnDays(3), ScheduleBasis.Experience, StageIndex: stage, Origin: origin, ReEntryHours: reEntry);

    private static OwnScheduleItem NewItem(ScheduleTaskContent content)
    {
        var item = OwnScheduleItem.Create(Farm, Plot, Cycle, Owner, content, Typist, At, out var revision, out var problem);
        problem.Should().BeNull();
        revision.Should().NotBeNull();
        return item!;
    }

    // ---- the item -------------------------------------------------------------------------------------------------------

    [Fact]
    public void Two_phones_compute_one_id_for_one_key_on_one_season()
    {
        OwnScheduleItem.IdFor(Cycle, "t1").Should().Be(OwnScheduleItem.IdFor(Cycle, "t1"));
        OwnScheduleItem.IdFor(Cycle, "t1").Should().NotBe(OwnScheduleItem.IdFor(Cycle, "t2"));
        OwnScheduleItem.IdFor(Cycle, "t1").Should().NotBe(OwnScheduleItem.IdFor(Guid.NewGuid(), "t1"));
        NewItem(Work("t1")).Id.Should().Be(OwnScheduleItem.IdFor(Cycle, "t1"));
    }

    [Fact]
    public void A_name_alone_saves_and_every_optional_part_may_be_absent()
    {
        var item = NewItem(new ScheduleTaskContent("t1", "छाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.None(), ScheduleBasis.Experience));
        item.Revision.Should().Be(1);
        item.State.Should().Be(OwnScheduleItemState.Active);
        item.TimerKind.Should().Be(ScheduleTimerKind.None);
    }

    [Fact]
    public void A_later_save_is_an_edit_with_a_revision_and_the_same_content_twice_writes_nothing()
    {
        var item = NewItem(Work("t1"));
        item.Save(Work("t1", ScheduleTaskTiming.OnDays(5)), Owner, Owner, At.AddMinutes(1), out var revision, out var problem).Should().BeTrue();
        problem.Should().BeNull();
        revision!.RevisionNumber.Should().Be(2);
        item.Revision.Should().Be(2);

        item.Save(Work("t1", ScheduleTaskTiming.OnDays(5)), Owner, Owner, At.AddMinutes(2), out var again, out _).Should().BeTrue();
        again.Should().BeNull("a save that changes nothing writes nothing");
        item.Revision.Should().Be(2);
    }

    [Fact]
    public void The_origin_of_the_first_save_never_changes()
    {
        var item = NewItem(Work("t1", origin: "माझा अनुभव"));
        item.Save(Work("t1", origin: "दुसरे"), Owner, Owner, At.AddMinutes(1), out _, out _).Should().BeTrue();
        item.Origin.Should().Be("माझा अनुभव");
        item.Content.Origin.Should().Be("माझा अनुभव");
    }

    [Fact]
    public void Remove_keeps_the_row_and_its_history_and_a_save_brings_it_back()
    {
        var item = NewItem(Work("t1"));
        item.Remove(Owner, Owner, At.AddMinutes(1), out var removed);
        removed!.Action.Should().Be(OwnScheduleItemAction.Removed);
        item.State.Should().Be(OwnScheduleItemState.Removed);
        item.Remove(Owner, Owner, At.AddMinutes(2), out var twice);
        twice.Should().BeNull();

        item.Save(Work("t1"), Owner, Owner, At.AddMinutes(3), out var back, out _).Should().BeTrue();
        back!.State.Should().Be(OwnScheduleItemState.Active);
        item.Revision.Should().Be(3);
    }

    [Fact]
    public void A_save_naming_another_key_or_a_broken_task_is_refused_and_changes_nothing()
    {
        var item = NewItem(Work("t1"));
        item.Save(Work("t2"), Owner, Owner, At, out var r1, out var p1).Should().BeFalse();
        p1!.Code.Should().Be("OwnScheduleItemKey");
        item.Save(Work("t1", ScheduleTaskTiming.OnDays(5, 2)), Owner, Owner, At, out var r2, out var p2).Should().BeFalse();
        p2!.Code.Should().Be("ScheduleTaskTimer");
        (r1, r2).Should().Be((null, null));
        item.Revision.Should().Be(1);
    }

    [Fact]
    public void The_wire_reader_refuses_an_unknown_key_and_a_missing_kind_but_never_a_missing_optional_part()
    {
        ScheduleTaskContent.TryParseWire("""{"taskKey":"t1","name":"छाटणी","kind":"work","timing":{"timer":"none"},"basis":"experience"}""", out var ok, out var p0)
            .Should().BeTrue(p0?.Message);
        ok!.Name.Should().Be("छाटणी");
        ScheduleTaskContent.TryParseWire("""{"taskKey":"t1","name":"छाटणी","kind":"work","timing":{"timer":"none"},"basis":"experience","price":5}""", out _, out var p1)
            .Should().BeFalse();
        p1!.Code.Should().Be("ScheduleTaskWire");
        ScheduleTaskContent.TryParseWire("""{"taskKey":"t1","name":"छाटणी","timing":{"timer":"none"},"basis":"experience"}""", out _, out var p2)
            .Should().BeFalse("an absent kind would otherwise read as the first word of its list");
        p2.Should().NotBeNull();
    }

    // ---- make main: the frozen version ------------------------------------------------------------------------------------

    private static readonly OwnScheduleStage[] Stages =
    [
        new("फुटवा", 0, 10, EndSign: "फूट दिसली"),
        new("वाढ", 20, 40),
    ];

    [Fact]
    public void Freeze_keeps_the_stage_line_its_sign_and_expected_end_day_and_each_works_stage()
    {
        var tasks = new[] { Work("feet", ScheduleTaskTiming.WhenSeen("फूट दिसली"), stage: 0), Work("tie", ScheduleTaskTiming.AfterTask("feet", 8), stage: 1) };
        var v1 = ScheduleTemplate.FreezeOwn(Guid.NewGuid(), null, "माझे", "grape", Owner, Typist, At, Stages, tasks, out var problem);
        problem.Should().BeNull();
        v1!.Version.Should().Be(1);
        v1.OwnerUserId.Should().Be(Owner);
        v1.TenantScope.Should().Be(TenantScope.Team);
        v1.Stages.Select(s => s.Name).Should().Equal("फुटवा", "वाढ");
        v1.StageRows.OrderBy(s => s.OrderIndex).First().EndSign.Should().Be("फूट दिसली");
        v1.StageRows.OrderBy(s => s.OrderIndex).First().EndDay.Should().Be(10);
        v1.Tasks.Single(t => t.TaskKey == "feet").StageIndex.Should().Be(0);
        v1.Tasks.Single(t => t.TaskKey == "tie").StageIndex.Should().Be(1);
        v1.Activities.Should().BeEmpty("an 'after' and a 'sign' work have no stored day; nothing is invented for old phones");
        v1.HasStoredDays.Should().BeFalse();
        v1.HasStageLine.Should().BeTrue();
    }

    [Fact]
    public void Freeze_writes_the_day_works_an_old_phone_can_hold_and_only_those()
    {
        var tasks = new[]
        {
            Work("once", ScheduleTaskTiming.OnDays(2, 4)),
            Work("every", ScheduleTaskTiming.OnDays(21).Repeating(ScheduleRepeatMode.EveryNDays, 7, endDay: 35), stage: 1),
            Work("open", ScheduleTaskTiming.OnDays(22).Repeating(ScheduleRepeatMode.EveryNDays, 7), stage: 1),
            Work("seen", ScheduleTaskTiming.WhenSeen("डाऊनी दिसला")),
            new ScheduleTaskContent("look", "पाहणी", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(3), ScheduleBasis.Experience),
        };
        var v1 = ScheduleTemplate.FreezeOwn(Guid.NewGuid(), null, "माझे", "grape", Owner, Typist, At, [new("फुटवा", 0, 10), new("वाढ", 20, 40)], tasks, out var problem)!;
        problem.Should().BeNull();
        v1.Activities.Select(a => a.ActivityName).Should().BeEquivalentTo(["काम once", "काम every"]);
        v1.HasStoredDays.Should().BeTrue();
        v1.ProjectedTaskKeyByActivity().Values.Should().BeEquivalentTo(["once", "every"]);
    }

    [Fact]
    public void A_next_version_never_shrinks_a_safety_gap_and_never_touches_the_version_before()
    {
        var v1 = ScheduleTemplate.FreezeOwn(Guid.NewGuid(), null, "माझे", "grape", Owner, Typist, At, Stages, [Work("t1", reEntry: 24)], out _)!;
        ScheduleTemplate.FreezeOwn(Guid.NewGuid(), v1, null, null, Owner, Typist, At, null, [Work("t1", reEntry: 12)], out var shrunk).Should().BeNull();
        shrunk!.Code.Should().Be("ScheduleTaskGapShortened");

        var v2 = ScheduleTemplate.FreezeOwn(Guid.NewGuid(), v1, null, null, Owner, Typist, At, null, [Work("t1", reEntry: 24), Work("t2")], out var problem)!;
        problem.Should().BeNull();
        v2.Version.Should().Be(2);
        v2.PreviousVersionId.Should().Be(v1.Id);
        v2.Name.Should().Be("माझे");
        v2.StageRows.Should().HaveCount(2, "absent stages are the version before's, signs included");
        v2.StageRows.Count(s => s.EndSign == "फूट दिसली").Should().Be(1);
        v1.Tasks.Should().HaveCount(1);
        v2.Tasks.Single(t => t.TaskKey == "t1").ContentHash.Should().Be(v1.Tasks.Single().ContentHash);
    }

    [Fact]
    public void Freeze_refuses_another_owners_version_no_stages_and_a_stage_before_day_0()
    {
        var v1 = ScheduleTemplate.FreezeOwn(Guid.NewGuid(), null, "माझे", "grape", Owner, Typist, At, Stages, [Work("t1")], out _)!;
        ScheduleTemplate.FreezeOwn(Guid.NewGuid(), v1, null, null, Typist, Typist, At, null, [Work("t1")], out var other).Should().BeNull();
        other!.Code.Should().Be("OwnSchedulePrevious");
        ScheduleTemplate.FreezeOwn(Guid.NewGuid(), null, "माझे", "grape", Owner, Typist, At, null, [Work("t1")], out var none).Should().BeNull();
        none!.Code.Should().Be("OwnScheduleStages");
        ScheduleTemplate.FreezeOwn(Guid.NewGuid(), null, "माझे", "grape", Owner, Typist, At, [new("छाटणीआधी", -5, 0)], [Work("t1")], out var early).Should().BeNull();
        early!.Code.Should().Be("OwnScheduleStageDays");
        ScheduleTemplate.FreezeOwn(Guid.NewGuid(), null, "माझे", "grape", Owner, Typist, At, [new("वाढ", 20, 40), new("फुटवा", 0, 10)], [Work("t1")], out var unordered)
            .Should().BeNull("a work names its stage by its place in the line ordered by day; the line is never re-ordered behind the works' backs");
        unordered!.Code.Should().Be("OwnScheduleStageOrder");
    }

    [Fact]
    public void A_whole_edit_of_a_version_in_the_task_format_is_refused_so_it_cannot_drop_its_tasks()
    {
        var v1 = ScheduleTemplate.FreezeOwn(Guid.NewGuid(), null, "माझे", "grape", Owner, Typist, At, Stages, [Work("t1")], out _)!;
        var edited = v1.EditCopyOnWrite(Guid.NewGuid(), null, null, [new StageDefinition("एक", 0, 10)], [], Owner, At, out var problem);
        edited.Should().BeNull();
        problem!.Code.Should().Be("ScheduleTaskFormatEdit");
        // A rename carries every task, every key and every sign by value.
        var renamed = v1.EditCopyOnWrite(Guid.NewGuid(), "नवे नाव", null, Owner, At);
        renamed.Tasks.Select(t => t.ContentHash).Should().Equal(v1.Tasks.Select(t => t.ContentHash));
        renamed.StageRows.Count(s => s.EndSign is not null).Should().Be(1);
    }

    // ---- the stage line: a stage that ends on a sign stays open until its sign ---------------------------------------------

    [Fact]
    public void A_sign_ended_stage_holds_the_days_after_its_expected_end_until_the_next_stage_starts()
    {
        var zero = new DateOnly(2026, 11, 1);
        var definition = new ScheduleDefinition(Guid.NewGuid(), "माझे",
            [new StageDefinition("फुटवा", 0, 10), new StageDefinition("वाढ", 20, 40)], [], EndsOnSign: [true, false]);
        ScheduleDefinitionMapper.StageHolding(definition, zero, zero.AddDays(5))!.Value.Stage.Name.Should().Be("फुटवा");
        ScheduleDefinitionMapper.StageHolding(definition, zero, zero.AddDays(15))!.Value.Stage.Name.Should().Be("फुटवा", "open until its sign");
        ScheduleDefinitionMapper.StageHolding(definition, zero, zero.AddDays(15))!.Value.Window.To.Should().Be(zero.AddDays(15), "no day is invented past the asked day");
        ScheduleDefinitionMapper.StageHolding(definition, zero, zero.AddDays(25))!.Value.Stage.Name.Should().Be("वाढ");
        ScheduleDefinitionMapper.StageHolding(definition, zero, zero.AddDays(50)).Should().BeNull("the last stage ends on its day: it has no sign");

        // Without signs: exactly the old windows (a gap day is in no stage).
        var old = definition with { EndsOnSign = null };
        ScheduleDefinitionMapper.StageHolding(old, zero, zero.AddDays(15)).Should().BeNull();
    }

    [Fact]
    public void A_last_stage_that_ends_on_a_sign_stays_open_past_its_expected_end()
    {
        var zero = new DateOnly(2026, 11, 1);
        var definition = new ScheduleDefinition(Guid.NewGuid(), "माझे", [new StageDefinition("काढणी", 0, 10)], [], EndsOnSign: [true]);
        ScheduleDefinitionMapper.StageHolding(definition, zero, zero.AddDays(30))!.Value.Stage.Name.Should().Be("काढणी");
    }
}
