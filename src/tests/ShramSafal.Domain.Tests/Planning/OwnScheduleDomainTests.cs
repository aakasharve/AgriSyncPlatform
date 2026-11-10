// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 2 (founder D-74, D-82 = 3; register R30, R32, R34).
// The domain half of "his own schedule": a farm's own schedule is a Team chain that names its FARM (OwnFarmId), is made empty (CreateOwn), and is
// changed by a whole new version (EditCopyOnWrite with stages and activities) that leaves the version before it untouched (P3). Pure: no I/O.
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class OwnScheduleDomainTests
{
    private static readonly Guid FarmA = Guid.Parse("a0a00000-0000-4000-8000-0000000000a1");
    private static readonly Guid FarmB = Guid.Parse("b0b00000-0000-4000-8000-0000000000b1");
    private static readonly UserId Maker = UserId.New();
    private static readonly UserId Delegate = UserId.New();
    private static readonly DateTime Now = new(2026, 11, 9, 6, 0, 0, DateTimeKind.Utc);

    private static readonly StageDefinition[] Stages = [new("Pruning", 0, 20), new("Growth", 21, 60)];

    private static ScheduleActivityDraft Draft(
        string name = "Drip Irrigation", string part = "irrigation", string? op = null, int start = 0, int end = 10,
        FrequencyMode mode = FrequencyMode.EveryNDays, int interval = 3) =>
        new(name, part, op, start, end, mode, interval);

    private static ScheduleTemplate EmptyOwn() =>
        ScheduleTemplate.CreateOwn(Guid.NewGuid(), "माझं द्राक्ष शेड्यूल", "Grapes", FarmA, Maker, Now);

    // ---- CreateOwn --------------------------------------------------------------------------------------------

    [Fact]
    public void CreateOwn_makes_an_empty_Team_version_1_that_names_its_farm()
    {
        var own = EmptyOwn();

        own.OwnFarmId.Should().Be(FarmA);
        own.TenantScope.Should().Be(TenantScope.Team);
        own.Version.Should().Be(1);
        own.OwnerType.Should().Be(ScheduleOwnerType.User);
        own.CropKey.Should().Be("Grapes");
        own.CreatedByUserId.Should().Be(Maker);
        own.PreviousVersionId.Should().BeNull();
        own.DerivedFromTemplateId.Should().BeNull();
        own.Stage.Should().BeEmpty("a blank start has no stage yet");
        own.Stages.Should().BeEmpty();
        own.Activities.Should().BeEmpty();
        own.HasStoredDays.Should().BeFalse("an empty schedule stores no days, so it can never be followed (R3, P4)");
    }

    [Theory]
    [InlineData("", "Grapes")]
    [InlineData("   ", "Grapes")]
    [InlineData("name", "")]
    [InlineData("name", "  ")]
    public void CreateOwn_refuses_a_blank_name_or_crop(string name, string crop)
    {
        var make = () => ScheduleTemplate.CreateOwn(Guid.NewGuid(), name, crop, FarmA, Maker, Now);
        make.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void CreateOwn_refuses_a_name_over_120_and_a_crop_over_60_but_takes_the_limit()
    {
        ScheduleTemplate.CreateOwn(Guid.NewGuid(), new string('न', 120), new string('c', 60), FarmA, Maker, Now).Name.Length.Should().Be(120);
        var longName = () => ScheduleTemplate.CreateOwn(Guid.NewGuid(), new string('न', 121), "Grapes", FarmA, Maker, Now);
        var longCrop = () => ScheduleTemplate.CreateOwn(Guid.NewGuid(), "name", new string('c', 61), FarmA, Maker, Now);
        longName.Should().Throw<ArgumentException>();
        longCrop.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void CreateOwn_refuses_an_empty_farm_id()
    {
        var make = () => ScheduleTemplate.CreateOwn(Guid.NewGuid(), "name", "Grapes", Guid.Empty, Maker, Now);
        make.Should().Throw<ArgumentException>();
    }

    // ---- the farm travels with every version ------------------------------------------------------------------

    [Fact]
    public void Every_EditCopyOnWrite_copies_the_farm_the_schedule_belongs_to()
    {
        var own = EmptyOwn();

        var rename = own.EditCopyOnWrite(Guid.NewGuid(), "नवीन नाव", null, Delegate, Now);

        rename.OwnFarmId.Should().Be(FarmA);
        rename.Version.Should().Be(2);
        rename.TenantScope.Should().Be(TenantScope.Team);
        rename.CreatedByUserId.Should().Be(Delegate, "each version shows who made it (D-88)");
    }

    [Fact]
    public void An_edit_of_a_row_with_no_farm_has_no_farm()
    {
        var plain = ScheduleTemplate.Create(Guid.NewGuid(), "Grapes", "Pruning", Now, Maker, TenantScope.Team);
        plain.EditCopyOnWrite(Guid.NewGuid(), "x", null, Maker, Now).OwnFarmId.Should().BeNull();
    }

    [Fact]
    public void Clone_with_a_farm_makes_that_farms_own_copy_and_without_one_makes_none()
    {
        var source = ScheduleTemplate.Create(Guid.NewGuid(), "Grapes", "Pruning", Now, Maker, TenantScope.Public);

        var intoOwn = source.Clone(Guid.NewGuid(), Maker, TenantScope.Team, "माझं शेड्यूल", Now, ownFarmId: FarmA);
        var plain = source.Clone(Guid.NewGuid(), Maker, TenantScope.Private, "माझी प्रत", Now);

        intoOwn.OwnFarmId.Should().Be(FarmA);
        intoOwn.TenantScope.Should().Be(TenantScope.Team);
        intoOwn.Version.Should().Be(1);
        intoOwn.DerivedFromTemplateId.Should().Be(source.Id, "it keeps where it came from");
        plain.OwnFarmId.Should().BeNull();
    }

    [Fact]
    public void Clone_of_a_farms_own_schedule_into_a_plain_copy_does_not_keep_the_farm()
    {
        var own = EmptyOwn();
        own.Clone(Guid.NewGuid(), Delegate, TenantScope.Private, "प्रत", Now).OwnFarmId.Should().BeNull();
    }

    // ---- EditCopyOnWrite with stages and activities -----------------------------------------------------------

    [Fact]
    public void An_edit_with_stages_and_activities_stores_exactly_those_and_leaves_the_version_before_untouched()
    {
        var v1 = EmptyOwn();

        var v2 = v1.EditCopyOnWrite(
            Guid.NewGuid(), null, null, Stages,
            [Draft("ठिबक सिंचन", "irrigation", start: 0, end: 20), Draft("बुरशीनाशक फवारणी", "spray", start: 21, end: 40, interval: 14)],
            Delegate, Now, out var problem);

        problem.Should().BeNull();
        v2.Should().NotBeNull();
        v2!.Version.Should().Be(2);
        v2.PreviousVersionId.Should().Be(v1.Id);
        v2.OwnFarmId.Should().Be(FarmA);
        v2.CreatedByUserId.Should().Be(Delegate);
        v2.Stage.Should().Be("Pruning", "the first stage by day");
        v2.Stages.Select(s => (s.Name, s.StartDay, s.EndDay)).Should().Equal(("Pruning", 0, 20), ("Growth", 21, 60));
        v2.Activities.Select(a => a.ActivityName).Should().BeEquivalentTo(["ठिबक सिंचन", "बुरशीनाशक फवारणी"]);
        v2.HasStoredDays.Should().BeTrue("stages and activities with every day stored");
        v2.Activities.Should().OnlyContain(a => a.HasStoredDays && a.AfterActivityId == null);
        v2.Activities.Select(a => a.Id).Distinct().Count().Should().Be(2, "the server mints every id");

        // P3: the version before is exactly as it was.
        v1.Version.Should().Be(1);
        v1.Activities.Should().BeEmpty();
        v1.Stages.Should().BeEmpty();
        v1.Stage.Should().BeEmpty();
    }

    [Fact]
    public void An_edit_replaces_the_activities_of_the_version_before_it_never_adds_to_them()
    {
        var v1 = EmptyOwn();
        var v2 = v1.EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft("A"), Draft("B")], Maker, Now, out _)!;

        var v3 = v2.EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft("C")], Maker, Now, out var problem)!;

        problem.Should().BeNull();
        v3.Activities.Select(a => a.ActivityName).Should().Equal("C");
        v2.Activities.Select(a => a.ActivityName).Should().BeEquivalentTo(["A", "B"], "the version before keeps its works");
    }

    [Fact]
    public void Stages_with_no_activities_make_a_version_with_no_works_not_a_copy_of_the_old_ones()
    {
        var v2 = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft()], Maker, Now, out _)!;

        var v3 = v2.EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [], Maker, Now, out var problem)!;

        problem.Should().BeNull();
        v3.Activities.Should().BeEmpty("D7: absent activities = none; nothing is carried over silently");
        v3.HasStoredDays.Should().BeFalse();
    }

    [Fact]
    public void A_new_name_is_taken_and_blank_means_unchanged()
    {
        var named = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), "  नवं नाव  ", null, Stages, [Draft()], Maker, Now, out _)!;
        var kept = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft()], Maker, Now, out _)!;

        named.Name.Should().Be("नवं नाव");
        kept.Name.Should().Be("माझं द्राक्ष शेड्यूल");
    }

    [Theory]
    [InlineData("irrigation", WorkPart.Irrigation)]
    [InlineData("Nutrition", WorkPart.Nutrition)]
    [InlineData("SPRAY", WorkPart.Spray)]
    [InlineData("work", WorkPart.Work)]
    public void The_part_is_read_case_blind_and_stored_as_the_part_name(string part, WorkPart expected)
    {
        var v2 = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(part: part)], Maker, Now, out var problem)!;

        problem.Should().BeNull();
        v2.Activities.Single().Part.Should().Be(expected.ToString());
    }

    [Fact]
    public void A_part_that_is_none_of_the_four_is_refused_with_words()
    {
        var v2 = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(part: "magic")], Maker, Now, out var problem);

        v2.Should().BeNull();
        problem.Should().NotBeNull();
        problem!.Code.Should().Be("ScheduleImportPart");
        problem.Message.Should().Contain("irrigation").And.Contain("work");
    }

    [Fact]
    public void The_draft_operation_key_wins_and_without_one_the_recogniser_proposes_it()
    {
        var v2 = EmptyOwn().EditCopyOnWrite(
            Guid.NewGuid(), null, null, Stages,
            [Draft("Pruning", "work", op: "op_thinning", mode: FrequencyMode.OneTime, interval: 1), Draft("Pruning again", "work", op: null, start: 5, end: 6, mode: FrequencyMode.OneTime, interval: 1)],
            Maker, Now, out var problem)!;

        problem.Should().BeNull();
        var byName = v2.Activities.ToDictionary(a => a.ActivityName);
        byName["Pruning"].OperationKey.Should().Be("op_thinning", "the phone's key is kept");
        byName["Pruning again"].OperationKey.Should().Be(WorkRecogniser.Recognise("Pruning again")?.OperationKey, "otherwise WORK-ID proposes it");
    }

    [Fact]
    public void Role_and_nutrient_are_proposed_as_import_does()
    {
        var v2 = EmptyOwn().EditCopyOnWrite(
            Guid.NewGuid(), null, null, Stages,
            [Draft("Boron spray", "spray", start: 1, end: 2, mode: FrequencyMode.OneTime, interval: 1)], Maker, Now, out _)!;

        var expected = WorkRecogniser.Recognise("Boron spray");
        v2.Activities.Single().Role.Should().Be(expected?.Role);
        v2.Activities.Single().NutrientKey.Should().Be(expected?.Role == "nutrient" ? expected.NutrientKey : null);
    }

    [Fact]
    public void A_one_time_work_stores_an_interval_of_1()
    {
        var v2 = EmptyOwn().EditCopyOnWrite(
            Guid.NewGuid(), null, null, Stages, [Draft(mode: FrequencyMode.OneTime, interval: 5)], Maker, Now, out _)!;

        v2.Activities.Single().StoredIntervalDays.Should().Be(1, "as import stores it");
        v2.Activities.Single().StoredFrequencyMode.Should().Be(FrequencyMode.OneTime);
    }

    [Theory]
    [InlineData("ScheduleImportStages")]
    public void No_stages_is_refused(string code)
    {
        var v2 = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [], [Draft()], Maker, Now, out var problem);
        v2.Should().BeNull();
        problem!.Code.Should().Be(code);
    }

    [Fact]
    public void A_stage_whose_end_is_before_its_start_is_refused_with_its_words()
    {
        var v2 = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [new("Bad", 10, 5)], [], Maker, Now, out var problem);
        v2.Should().BeNull();
        problem!.Code.Should().Be("ScheduleImportStageDays");
        problem.Message.Should().Contain("Bad");
    }

    [Fact]
    public void A_stage_with_a_blank_name_or_a_negative_start_is_refused()
    {
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [new(" ", 0, 5)], [], Maker, Now, out var blank).Should().BeNull();
        blank!.Code.Should().Be("ScheduleImportStages");
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [new("A", -1, 5)], [], Maker, Now, out var negative).Should().BeNull();
        negative!.Code.Should().Be("ScheduleImportStageDays");
    }

    [Fact]
    public void An_activity_whose_end_is_before_its_start_is_refused()
    {
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(start: 9, end: 3)], Maker, Now, out var problem).Should().BeNull();
        problem!.Code.Should().Be("ScheduleImportActivityDays");
    }

    [Fact]
    public void An_activity_outside_every_stage_or_past_the_last_day_is_refused()
    {
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(start: 0, end: 61)], Maker, Now, out var past).Should().BeNull();
        past!.Code.Should().Be("ScheduleImportOutsideStages");
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [new("Late", 10, 20)], [Draft(start: 0, end: 5)], Maker, Now, out var before).Should().BeNull();
        before!.Code.Should().Be("ScheduleImportOutsideStages");
    }

    [Theory]
    [InlineData(FrequencyMode.EveryNDays, 0)]
    [InlineData(FrequencyMode.PerWeek, 0)]
    [InlineData(FrequencyMode.PerWeek, 8)]
    [InlineData(FrequencyMode.OneTime, 0)]
    public void A_repeat_that_is_not_valid_is_refused(FrequencyMode mode, int interval)
    {
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(mode: mode, interval: interval)], Maker, Now, out var problem).Should().BeNull();
        problem!.Code.Should().Be("ScheduleImportRepeat");
    }

    [Fact]
    public void An_activity_with_a_blank_or_too_long_name_is_refused()
    {
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(name: "  ")], Maker, Now, out var blank).Should().BeNull();
        blank!.Code.Should().Be("ScheduleImportActivityName");
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(name: new string('x', 121))], Maker, Now, out var longName).Should().BeNull();
        longName!.Code.Should().Be("ScheduleImportActivityName");
    }

    [Fact]
    public void A_refused_edit_changes_nothing_on_the_source()
    {
        var v1 = EmptyOwn();
        v1.EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(part: "x")], Maker, Now, out _).Should().BeNull();
        v1.DomainEvents.Should().BeEmpty("no edited event for a version that was never made");
        v1.Version.Should().Be(1);
    }

    [Fact]
    public void A_made_version_raises_the_edited_event_once()
    {
        var v2 = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft()], Maker, Now, out _)!;
        v2.DomainEvents.OfType<ScheduleTemplateEditedEvent>().Should().HaveCount(1);
    }

    [Fact]
    public void The_import_rule_is_unchanged_by_sharing_its_day_checks()
    {
        // The day rules were extracted from Import (D9): an import still refuses what it refused, with the same code.
        var bad = ScheduleTemplate.Import(
            Guid.NewGuid(), "X", ScheduleOwnerType.Institution, null, "grape", Maker, TenantScope.Public, Now, Stages,
            [new ImportedActivity("a", "Pruning", 5, 2, FrequencyMode.OneTime, 1)], out var problem);
        bad.Should().BeNull();
        problem!.Code.Should().Be("ScheduleImportActivityDays");

        var good = ScheduleTemplate.Import(
            Guid.NewGuid(), "X", ScheduleOwnerType.Institution, null, "grape", Maker, TenantScope.Public, Now, Stages,
            [new ImportedActivity("a", "Pruning", 0, 2, FrequencyMode.OneTime, 1)], out var none);
        none.Should().BeNull();
        good!.HasStoredDays.Should().BeTrue();
        good.OwnFarmId.Should().BeNull("an import is never a farm's own schedule");
    }

    [Fact]
    public void Two_farms_own_schedules_of_the_same_source_are_different_chains()
    {
        var source = ScheduleTemplate.Create(Guid.NewGuid(), "Grapes", "Pruning", Now, Maker, TenantScope.Public);
        var a = source.Clone(Guid.NewGuid(), Maker, TenantScope.Team, "r", Now, ownFarmId: FarmA);
        var b = source.Clone(Guid.NewGuid(), Delegate, TenantScope.Team, "r", Now, ownFarmId: FarmB);

        a.DerivedFromTemplateId.Should().Be(b.DerivedFromTemplateId);
        a.OwnFarmId.Should().Be(FarmA);
        b.OwnFarmId.Should().Be(FarmB);
    }

    // ---- fix round 1, M002: the operation key and the contract's bounds are enforced by the domain ----------------

    private static string Key(int length) => "op_" + new string('a', length - 3);

    [Fact]
    public void An_operation_key_of_exactly_40_characters_is_stored_and_one_of_41_is_refused()
    {
        var ok = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(op: Key(40))], Maker, Now, out var problem)!;
        problem.Should().BeNull();
        ok.Activities.Single().OperationKey.Should().Be(Key(40));

        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(op: Key(41))], Maker, Now, out var tooLong).Should().BeNull();
        tooLong!.Code.Should().Be("ScheduleImportOperationKey");
        tooLong.Message.Should().Contain("40");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("pruning")]
    [InlineData("OP_PRUNING")]
    [InlineData("op_has space")]
    [InlineData("op_")]
    public void An_operation_key_that_is_empty_or_not_the_shape_of_a_work_key_is_refused(string key)
    {
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(op: key)], Maker, Now, out var problem).Should().BeNull();
        problem!.Code.Should().Be("ScheduleImportOperationKey");
    }

    [Fact]
    public void No_operation_key_at_all_is_still_proposed_by_the_recogniser()
    {
        var v2 = EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, [Draft(name: "Pruning", part: "work", op: null)], Maker, Now, out var problem)!;
        problem.Should().BeNull();
        v2.Activities.Single().OperationKey.Should().Be(WorkRecogniser.Recognise("Pruning")?.OperationKey);
    }

    [Fact]
    public void More_than_40_stages_or_300_activities_or_a_day_beyond_3650_is_refused_with_the_import_codes()
    {
        var manyStages = Enumerable.Range(0, 41).Select(i => new StageDefinition("S" + i, i * 10, i * 10 + 9)).ToList();
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, manyStages, [], Maker, Now, out var stages).Should().BeNull();
        stages!.Code.Should().Be("ScheduleImportStages");
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, manyStages.Take(40).ToList(), [], Maker, Now, out var forty).Should().NotBeNull();
        forty.Should().BeNull();

        var many = Enumerable.Range(0, 301).Select(i => Draft("W" + i, "work", start: 0, end: 1, mode: FrequencyMode.OneTime, interval: 1)).ToList();
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, many, Maker, Now, out var activities).Should().BeNull();
        activities!.Code.Should().Be("ScheduleImportActivities");
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, Stages, many.Take(300).ToList(), Maker, Now, out var threeHundred).Should().NotBeNull();
        threeHundred.Should().BeNull();

        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [new("Long", 0, 3651)], [], Maker, Now, out var stageDays).Should().BeNull();
        stageDays!.Code.Should().Be("ScheduleImportStageDays");
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [new("Long", 0, 3650)], [Draft(start: 0, end: 3651)], Maker, Now, out var activityDays).Should().BeNull();
        activityDays!.Code.Should().Be("ScheduleImportActivityDays");
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [new("Long", 0, 3650)], [Draft(start: 0, end: 3650, interval: 3651)], Maker, Now, out var repeat).Should().BeNull();
        repeat!.Code.Should().Be("ScheduleImportRepeat");
        EmptyOwn().EditCopyOnWrite(Guid.NewGuid(), null, null, [new("Long", 0, 3650)], [Draft(start: 0, end: 3650, interval: 3650)], Maker, Now, out var edge).Should().NotBeNull();
        edge.Should().BeNull();
    }
}
