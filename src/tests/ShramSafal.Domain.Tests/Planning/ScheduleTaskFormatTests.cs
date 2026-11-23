// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
// The ONE task format, pure (no I/O): what a task holds, which timer rules it keeps (negative days are allowed - the old import refused them), that its
// content hash covers EVERY field, how a version carries its tasks (same keys, new row ids, "after" by KEY so a whole edit cannot orphan it), and that a
// safety gap never shrinks from one version to the next. Doctrine P4 (nothing invented), P8 (the basis is recorded), P9 (no optional field refuses).
using System.Text.Json.Nodes;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleTaskFormatTests
{
    private static readonly UserId Owner = new(Guid.Parse("a0a00000-0000-4000-8000-0000000000a1"));
    private static readonly UserId Typist = new(Guid.Parse("b0b00000-0000-4000-8000-0000000000b1"));
    private static readonly DateTime Now = new(2026, 11, 23, 6, 0, 0, DateTimeKind.Utc);

    private static ScheduleTaskContent Minimal(string key = "t1", ScheduleTaskTiming? timing = null) =>
        new(key, "फवारणी", ScheduleTaskKind.Spray, timing ?? ScheduleTaskTiming.None(), ScheduleBasis.Stated);

    /// <summary>Every field set, so a mutation of any one of them can be seen in the hash.</summary>
    private static ScheduleTaskContent Full(ScheduleTaskTiming? timing = null) => new(
        TaskKey: "spray-one",
        Name: "लांबट मण्यांचे वाण: फुलोऱ्यात GA३",
        Kind: ScheduleTaskKind.Spray,
        Timing: timing ?? ScheduleTaskTiming.OnDays(35, 50, whenWords: "फुलोरा (दिवस ३६–५०)")
            .Repeating(ScheduleRepeatMode.EveryNDays, 7, endDay: 60),
        Basis: ScheduleBasis.OurChoice,
        StageIndex: 1,
        Order: 3,
        Why: "मणी लांबट होण्यासाठी.",
        Dose: "GA३ १५ ppm",
        Steps: ["हे फक्त लांबट मणी हवे असलेल्या वाणांसाठी आहे.", "सामू ५.५–६ ठेवा."],
        Products: [new ScheduleProduct("GA३", "१५", "ppm", "लिटर पाणी", "५०० लिटर")],
        ReEntryHours: 24,
        PreHarvestDays: 15,
        Warnings: ["पूर्ण फुलोऱ्यात फवारल्यास मणी गळतात."],
        Look: new ScheduleTaskLook("घड", "५ वेली", "मणी लांबट", "५०%", [new ScheduleIfThen("पाऊस", "फवारणी पुढे ढकला")], "P02"),
        Ask: new ScheduleTaskAsk("फुलोरा ५०% झाला का?", "सकाळी", [new ScheduleAnswer("yes", "आज फवारा"), new ScheduleAnswer("no", "उद्या पुन्हा पाहा")]),
        Sources: [new ScheduleSource("पुस्तक", "८२"), new ScheduleSource("कॅलेंडर", "१४")],
        Origin: "reader");

    // ---- the timers -----------------------------------------------------------------------------------------------

    [Fact]
    public void A_day_window_may_start_before_the_start_day_negative_days_are_kept()
    {
        var content = Minimal(timing: ScheduleTaskTiming.OnDays(-20, -18));

        content.Check().Should().BeNull("the old import refused every negative day; the new format keeps 'छाटणीआधी २० दिवस' as stored -20");
        content.Timing.FromDay.Should().Be(-20);
        content.Timing.ToDay.Should().Be(-18);
    }

    [Fact]
    public void A_task_holds_exactly_one_timer_or_none_yet()
    {
        Minimal(timing: ScheduleTaskTiming.None()).Check().Should().BeNull();
        Minimal(timing: ScheduleTaskTiming.OnDays(3)).Check().Should().BeNull();
        Minimal(timing: ScheduleTaskTiming.AfterTask("t0", usualDays: 4)).Check().Should().BeNull();
        Minimal(timing: ScheduleTaskTiming.WhenSeen("फुलोरा दिसल्यावर")).Check().Should().BeNull();

        // Two timers at once: a day AND a sign, a day AND an "after".
        Minimal(timing: ScheduleTaskTiming.OnDays(3) with { SignWords = "फुलोरा" }).Check()!.Code.Should().Be("ScheduleTaskTimer");
        Minimal(timing: ScheduleTaskTiming.OnDays(3) with { AfterTaskKey = "t0" }).Check()!.Code.Should().Be("ScheduleTaskTimer");
        Minimal(timing: ScheduleTaskTiming.None() with { FromDay = 1 }).Check()!.Code.Should().Be("ScheduleTaskTimer");
        Minimal(timing: ScheduleTaskTiming.WhenSeen("फुलोरा") with { UsualDays = 3 }).Check()!.Code.Should().Be("ScheduleTaskTimer");
    }

    [Fact]
    public void Each_timer_keeps_its_own_rules()
    {
        Minimal(timing: ScheduleTaskTiming.OnDays(5, 4)).Check()!.Code.Should().Be("ScheduleTaskTimer", "a window may not end before it starts");
        Minimal(timing: ScheduleTaskTiming.OnDays(4000)).Check()!.Code.Should().Be("ScheduleTaskTimer", "days stay within 3650 either way");
        Minimal(timing: ScheduleTaskTiming.OnDays(-4000)).Check()!.Code.Should().Be("ScheduleTaskTimer");

        Minimal("t1", ScheduleTaskTiming.AfterTask("t1", usualDays: 2)).Check()!.Code.Should().Be("ScheduleTaskTimer", "a work cannot follow itself");
        Minimal(timing: ScheduleTaskTiming.AfterTask("", usualDays: 2)).Check()!.Code.Should().Be("ScheduleTaskTimer");
        Minimal(timing: ScheduleTaskTiming.AfterTask("t0", earliestDays: 9, latestDays: 3)).Check()!.Code.Should().Be("ScheduleTaskTimer");
        Minimal(timing: ScheduleTaskTiming.AfterTask("t0", usualDays: 1, earliestDays: 3)).Check()!.Code.Should().Be("ScheduleTaskTimer", "the usual day lies within earliest and latest");
        Minimal(timing: ScheduleTaskTiming.AfterTask("t0", usualDays: -1)).Check()!.Code.Should().Be("ScheduleTaskTimer", "a work after another is never before it");

        Minimal(timing: ScheduleTaskTiming.WhenSeen("  ")).Check()!.Code.Should().Be("ScheduleTaskTimer", "a sign needs its words");
        Minimal(timing: ScheduleTaskTiming.WhenSeen("फुलोरा", expectedToDay: 9)).Check()!.Code.Should().Be("ScheduleTaskTimer", "an expected end needs an expected start");
        Minimal(timing: ScheduleTaskTiming.WhenSeen("फुलोरा", expectedFromDay: 9, expectedToDay: 3)).Check()!.Code.Should().Be("ScheduleTaskTimer");
        Minimal(timing: ScheduleTaskTiming.WhenSeen("फुलोरा", expectedFromDay: -5, expectedToDay: 3)).Check().Should().BeNull();
    }

    [Fact]
    public void A_repeat_is_once_every_N_or_per_week_with_an_optional_end()
    {
        var day = ScheduleTaskTiming.OnDays(2, 41);

        Minimal(timing: day).Check().Should().BeNull("once is the default");
        Minimal(timing: day.Repeating(ScheduleRepeatMode.EveryNDays, 3)).Check().Should().BeNull();
        Minimal(timing: day.Repeating(ScheduleRepeatMode.PerWeek, 2, endSign: "फळे पक्व झाल्यावर")).Check().Should().BeNull();
        Minimal(timing: day.Repeating(ScheduleRepeatMode.EveryNDays, 3, endDay: 40)).Check().Should().BeNull();

        Minimal(timing: day.Repeating(ScheduleRepeatMode.EveryNDays, 0)).Check()!.Code.Should().Be("ScheduleTaskRepeat");
        Minimal(timing: day.Repeating(ScheduleRepeatMode.PerWeek, 8)).Check()!.Code.Should().Be("ScheduleTaskRepeat", "per week is 1 to 7");
        Minimal(timing: day with { RepeatInterval = 3 }).Check()!.Code.Should().Be("ScheduleTaskRepeat", "a once-only work has no interval");
        Minimal(timing: day with { RepeatEndDay = 9 }).Check()!.Code.Should().Be("ScheduleTaskRepeat", "a once-only work has no end of its repeat");
        Minimal(timing: day.Repeating(ScheduleRepeatMode.EveryNDays, 3, endDay: 9, endSign: "x")).Check()!.Code.Should().Be("ScheduleTaskRepeat", "one end, not two");
    }

    // ---- the task -------------------------------------------------------------------------------------------------

    [Fact]
    public void Nothing_optional_refuses_a_task_P9()
    {
        var bare = new ScheduleTaskContent("t1", "पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.None(), ScheduleBasis.Assumed);

        bare.Check().Should().BeNull("a name, a kind, a basis and a key are all a task needs; every other part may be absent");
        bare.Steps.Should().BeNull();
        bare.Normalized().Steps.Should().BeEmpty();
        Full().Check().Should().BeNull();
    }

    [Theory]
    [InlineData("", "ScheduleTaskKey")]
    [InlineData(" ", "ScheduleTaskKey")]
    [InlineData("has space", "ScheduleTaskKey")]
    [InlineData("é", "ScheduleTaskKey")]
    public void A_task_needs_a_key_of_plain_characters(string key, string code)
    {
        Minimal(key).Check()!.Code.Should().Be(code);
    }

    [Fact]
    public void A_task_needs_a_name_and_keeps_every_part_within_its_bounds()
    {
        (Minimal() with { Name = " " }).Check()!.Code.Should().Be("ScheduleTaskName");
        (Minimal() with { Name = new string('क', 201) }).Check()!.Code.Should().Be("ScheduleTaskName");
        (Minimal() with { StageIndex = -1 }).Check()!.Code.Should().Be("ScheduleTaskStage");
        (Minimal() with { StageIndex = 40 }).Check()!.Code.Should().Be("ScheduleTaskStage");
        (Minimal() with { Order = -1 }).Check()!.Code.Should().Be("ScheduleTaskOrder");
        (Minimal() with { ReEntryHours = -1 }).Check()!.Code.Should().Be("ScheduleTaskGap");
        (Minimal() with { PreHarvestDays = 366 }).Check()!.Code.Should().Be("ScheduleTaskGap");
        (Minimal() with { Steps = Enumerable.Repeat("x", 21).ToList() }).Check()!.Code.Should().Be("ScheduleTaskBounds");
        (Minimal() with { Steps = [new string('x', 1001)] }).Check()!.Code.Should().Be("ScheduleTaskBounds");
        (Minimal() with { Sources = Enumerable.Repeat(new ScheduleSource("पुस्तक", "1"), 41).ToList() }).Check()!.Code.Should().Be("ScheduleTaskBounds");
        (Minimal() with { Products = [new ScheduleProduct(" ")] }).Check()!.Code.Should().Be("ScheduleTaskBounds", "a product line needs its name");
        (Minimal() with { Sources = [new ScheduleSource(" ")] }).Check()!.Code.Should().Be("ScheduleTaskBounds", "a source line names its document");
    }

    // ---- the content hash covers every field ----------------------------------------------------------------------

    [Fact]
    public void The_content_hash_is_stable_and_the_same_for_absent_and_empty_lists()
    {
        Full().ContentHash().Should().MatchRegex("^[0-9a-f]{64}$");
        Full().ContentHash().Should().Be(Full().ContentHash());
        Minimal().ContentHash().Should().Be((Minimal() with { Steps = [], Products = [], Warnings = [], Sources = [] }).ContentHash(),
            "an absent list and an empty one are the same content");
        Minimal().ContentHash().Should().NotBe(Minimal("t2").ContentHash());
    }

    public static IEnumerable<object[]> FullVariants() =>
    [
        ["a day window that repeats every N days with an end day", Full()],
        ["an 'after' that repeats per week with an end sign", Full(ScheduleTaskTiming.AfterTask("prev", 4, 3, 9, "४–५ दिवसांनी").Repeating(ScheduleRepeatMode.PerWeek, 2, endSign: "फळे पक्व झाल्यावर"))],
        ["a sign with an expected window", Full(ScheduleTaskTiming.WhenSeen("मणी ३–४ मि.मी.", -5, 9, "मणी झाल्यावर"))],
    ];

    [Theory]
    [MemberData(nameof(FullVariants))]
    public void The_content_hash_includes_every_field_of_the_task(string variant, ScheduleTaskContent full)
    {
        var original = full.ToCanonicalJson();
        var json = JsonNode.Parse(original)!;
        var changed = 0;

        foreach (var path in LeafPaths(json).ToList())
        {
            var copy = JsonNode.Parse(original)!;
            Mutate(copy, path);
            var mutated = ScheduleTaskContent.FromCanonicalJson(copy.ToJsonString())!;

            mutated.ContentHash().Should().NotBe(full.ContentHash(), $"({variant}) changing '{string.Join(".", path)}' must change the hash");
            changed++;
        }

        changed.Should().BeGreaterThan(30, "the sample sets every field, so the leaves are all there");
        // Fail loudly if a field is ever added to the task and left out of its canonical form: every public property is a key of the JSON.
        typeof(ScheduleTaskContent).GetProperties().Select(p => p.Name)
            .Should().BeEquivalentTo(
                json.AsObject().Select(kv => char.ToUpperInvariant(kv.Key[0]) + kv.Key[1..]),
                "every public property of the task is in its canonical JSON, so every property is in the hash");
    }

    [Fact]
    public void The_canonical_json_round_trips_without_losing_anything()
    {
        var full = Full();
        var back = ScheduleTaskContent.FromCanonicalJson(full.ToCanonicalJson())!;

        back.ContentHash().Should().Be(full.ContentHash());
        back.Should().BeEquivalentTo(full.Normalized());
        back.Timing.RepeatEndDay.Should().Be(60);
        back.Look!.IfThen.Should().ContainSingle().Which.Then.Should().Be("फवारणी पुढे ढकला");
    }

    // ---- the safety gap never shrinks -----------------------------------------------------------------------------

    [Fact]
    public void SafetyGap_NeverShrinks()
    {
        var before = Minimal() with { ReEntryHours = 24, PreHarvestDays = 15 };

        ScheduleSafetyGaps.Check(before, before with { PreHarvestDays = 7 })!.Code.Should().Be("ScheduleTaskGapShortened", "a pre-harvest gap of 15 days is never made 7");
        ScheduleSafetyGaps.Check(before, before with { ReEntryHours = 12 })!.Code.Should().Be("ScheduleTaskGapShortened");
        ScheduleSafetyGaps.Check(before, before with { PreHarvestDays = null })!.Code.Should().Be("ScheduleTaskGapShortened", "dropping a stated gap is shortening it to nothing");
        ScheduleSafetyGaps.Check(before, before with { ReEntryHours = null })!.Code.Should().Be("ScheduleTaskGapShortened");

        ScheduleSafetyGaps.Check(before, before).Should().BeNull("the same gap is fine");
        ScheduleSafetyGaps.Check(before, before with { PreHarvestDays = 21, ReEntryHours = 48 }).Should().BeNull("a longer gap is fine");
        ScheduleSafetyGaps.Check(Minimal(), Minimal() with { PreHarvestDays = 3 }).Should().BeNull("a gap that was never stated can be given");
        ScheduleSafetyGaps.Check(before, Minimal("other"))!.Code.Should().Be("ScheduleTaskGapKey", "only the same task is compared");
    }

    [Fact]
    public void SafetyGap_NeverShrinks_AcrossAWholeVersion()
    {
        var before = new[] { Minimal("a") with { PreHarvestDays = 15 }, Minimal("b") with { ReEntryHours = 6 }, Minimal("gone") with { PreHarvestDays = 30 } };

        ScheduleSafetyGaps.CheckVersion(before, [Minimal("a") with { PreHarvestDays = 15 }, Minimal("b") with { ReEntryHours = 6 }])
            .Should().BeNull("a task that is left out of the next version has no gap to shrink; the others keep theirs");
        ScheduleSafetyGaps.CheckVersion(before, [Minimal("a") with { PreHarvestDays = 10 }, Minimal("b") with { ReEntryHours = 6 }])!
            .Message.Should().Contain("a");
        ScheduleSafetyGaps.CheckVersion(before, [Minimal("a") with { PreHarvestDays = 15 }, Minimal("b")])!.Code.Should().Be("ScheduleTaskGapShortened");
    }

    // ---- a version holds its tasks --------------------------------------------------------------------------------

    private static ScheduleTemplate OwnWithStages() =>
        ScheduleTemplate.CreateOwn(Guid.NewGuid(), "माझं द्राक्ष शेड्यूल", "Grapes", Owner, Typist, Now);

    private static ScheduleTemplate OwnWithTasks(out ScheduleTaskProblem? problem)
    {
        var template = ScheduleTemplate.Import(
            Guid.NewGuid(), "द्राक्ष", ScheduleOwnerType.User, "my source", "Grapes", Typist, TenantScope.Team, Now,
            [new StageDefinition("छाटणी", 0, 40), new StageDefinition("फुलोरा", 41, 60)],
            [new ImportedActivity("p", "Pruning", 0, 0, FrequencyMode.OneTime, 1)], out _)!;
        template.SetStageSigns([new ScheduleStageSign(1, StartSign: "फुलोरा दिसल्यावर", EndSign: "मणी धरल्यावर")], out _);
        template.SetTasks(
            [
                Minimal("first", ScheduleTaskTiming.OnDays(-3, -3)),
                Minimal("second", ScheduleTaskTiming.AfterTask("first", usualDays: 5)) with { StageIndex = 1, Order = 1 },
                Minimal("third", ScheduleTaskTiming.WhenSeen("पाने उघडल्यावर")) with { StageIndex = 1, Order = 2 },
            ],
            [new ScheduleChallengeContent("c-mildew", "केवडा", StageIndex: 1, WhenWords: "दिवस ३५–५०", Signs: "पानांवर डाग",
                Action: "फवारणी", IfThen: [new ScheduleIfThen("पाऊस", "फवारण्या वाढवा")], Sources: [new ScheduleSource("GAP", "३५")])],
            out problem);
        return template;
    }

    [Fact]
    public void SetTasks_stamps_the_tenant_of_the_version_on_every_task_and_challenge()
    {
        var template = OwnWithTasks(out var problem);

        problem.Should().BeNull();
        template.Tasks.Should().HaveCount(3);
        template.Challenges.Should().ContainSingle();
        template.Tasks.Should().OnlyContain(t => t.TenantScope == TenantScope.Team && t.ScheduleTemplateId == template.Id);
        template.Tasks.Should().OnlyContain(t => t.OwnerUserId == Typist, "an imported row with no owner column names its maker");
        template.Tasks.Select(t => t.Id).Distinct().Should().HaveCount(3).And.NotContain(Guid.Empty);
        template.Tasks.Single(t => t.TaskKey == "first").ContentHash.Should().Be(Minimal("first", ScheduleTaskTiming.OnDays(-3, -3)).ContentHash());

        var own = OwnWithStages();
        own.SetTasks([Minimal("x")], [], out _);
        own.Tasks.Single().OwnerUserId.Should().Be(Owner, "his own schedule names its OWNER, never the typist");
        own.Tasks.Single().TenantScope.Should().Be(TenantScope.Team);
    }

    [Fact]
    public void SetTasks_refuses_a_set_that_does_not_hold_together()
    {
        ScheduleTaskProblem? Refuse(IReadOnlyList<ScheduleTaskContent> tasks, IReadOnlyList<ScheduleChallengeContent>? challenges = null)
        {
            var t = ScheduleTemplate.Import(
                Guid.NewGuid(), "द्राक्ष", ScheduleOwnerType.User, null, "Grapes", Typist, TenantScope.Team, Now,
                [new StageDefinition("छाटणी", 0, 40), new StageDefinition("फुलोरा", 41, 60)],
                [new ImportedActivity(null, "Pruning", 0, 0, FrequencyMode.OneTime, 1)], out _)!;
            var ok = t.SetTasks(tasks, challenges ?? [], out var problem);
            ok.Should().Be(problem is null);
            if (problem is not null)
            {
                t.Tasks.Should().BeEmpty("a refused set leaves the version as it was");
            }

            return problem;
        }

        Refuse([Minimal("a"), Minimal("a")])!.Code.Should().Be("ScheduleTaskKeyTaken");
        Refuse([Minimal("a", ScheduleTaskTiming.AfterTask("nowhere", usualDays: 1))])!.Code.Should().Be("ScheduleTaskAfter", "an 'after' names a task of the same version");
        Refuse([Minimal("a", ScheduleTaskTiming.AfterTask("b", usualDays: 1)), Minimal("b", ScheduleTaskTiming.AfterTask("a", usualDays: 1))])!
            .Code.Should().Be("ScheduleTaskAfter", "an order that loops back is refused");
        Refuse([Minimal("a") with { StageIndex = 2 }])!.Code.Should().Be("ScheduleTaskStage", "this version has two stages (0 and 1)");
        Refuse([Minimal(" ")])!.Code.Should().Be("ScheduleTaskKey");
        Refuse([Minimal("a")], [new ScheduleChallengeContent("c", "x", StageIndex: 5)])!.Code.Should().Be("ScheduleChallengeStage");
        Refuse([Minimal("a")], [new ScheduleChallengeContent("c", " ")])!.Code.Should().Be("ScheduleChallengeTitle");
        Refuse([Minimal("a")], [new ScheduleChallengeContent("c", "x"), new ScheduleChallengeContent("c", "y")])!.Code.Should().Be("ScheduleChallengeKeyTaken");

        var once = OwnWithTasks(out _);
        once.SetTasks([Minimal("late")], [], out var second).Should().BeFalse();
        second!.Code.Should().Be("ScheduleTaskAlreadySet", "tasks are written once per version; a change is a new version (P3)");
        once.Tasks.Should().HaveCount(3);
    }

    [Fact]
    public void A_stage_may_start_or_end_on_a_sign_and_the_sign_is_optional()
    {
        var template = OwnWithTasks(out _);

        template.StageRows.OrderBy(s => s.OrderIndex).Select(s => (s.StartSign, s.EndSign))
            .Should().Equal(new (string?, string?)[] { (null, null), ("फुलोरा दिसल्यावर", "मणी धरल्यावर") });
        template.Stages.Select(s => (s.Name, s.StartDay, s.EndDay))
            .Should().Equal(new (string, int, int)[] { ("छाटणी", 0, 40), ("फुलोरा", 41, 60) }, "the day numbers are untouched by a sign");

        template.SetStageSigns([new ScheduleStageSign(7, StartSign: "x")], out var problem).Should().BeFalse();
        problem!.Code.Should().Be("ScheduleStageSign");
        template.SetStageSigns([new ScheduleStageSign(0, StartSign: " ")], out problem).Should().BeFalse("a sign is words or absent, never blank");
        template.SetStageSigns([new ScheduleStageSign(0, EndSign: new string('x', 161))], out problem).Should().BeFalse();
    }

    [Fact]
    public void A_clone_and_a_rename_carry_the_tasks_by_value_with_the_same_keys_and_new_ids()
    {
        var source = OwnWithTasks(out _);

        var clone = source.Clone(Guid.NewGuid(), Owner, TenantScope.Team, "farm copy", Now, ownerUserId: Owner);
        var renamed = source.EditCopyOnWrite(Guid.NewGuid(), "नवे नाव", null, Typist, Now);

        foreach (var copy in new[] { clone, renamed })
        {
            copy.Tasks.Select(t => t.TaskKey).Should().BeEquivalentTo(source.Tasks.Select(t => t.TaskKey));
            copy.Tasks.Select(t => t.Id).Should().NotIntersectWith(source.Tasks.Select(t => t.Id), "a copy is new rows");
            copy.Tasks.Should().OnlyContain(t => t.ScheduleTemplateId == copy.Id);
            copy.Tasks.OrderBy(t => t.TaskKey).Select(t => t.ContentHash)
                .Should().Equal(source.Tasks.OrderBy(t => t.TaskKey).Select(t => t.ContentHash), "the content did not change, so the hash did not");
            copy.Tasks.Single(t => t.TaskKey == "second").Content.Timing.AfterTaskKey.Should().Be("first", "'after' is held by KEY, so a copy cannot orphan it");
            copy.Challenges.Should().ContainSingle().Which.ChallengeKey.Should().Be("c-mildew");
            copy.StageRows.OrderBy(s => s.OrderIndex).Select(s => (s.StartSign, s.EndSign))
                .Should().Equal(new (string?, string?)[] { (null, null), ("फुलोरा दिसल्यावर", "मणी धरल्यावर") }, "a copy keeps the stage signs");
        }

        clone.Tasks.Should().OnlyContain(t => t.OwnerUserId == Owner, "a clone INTO his own schedule names its owner");
        source.Tasks.Should().HaveCount(3, "the version before is not touched");
    }

    [Fact]
    public void A_template_with_tasks_reads_exactly_as_one_without_for_every_existing_reader()
    {
        var with = OwnWithTasks(out _);
        var without = ScheduleTemplate.Import(
            Guid.NewGuid(), "द्राक्ष", ScheduleOwnerType.User, "my source", "Grapes", Typist, TenantScope.Team, Now,
            [new StageDefinition("छाटणी", 0, 40), new StageDefinition("फुलोरा", 41, 60)],
            [new ImportedActivity("p", "Pruning", 0, 0, FrequencyMode.OneTime, 1)], out _)!;

        with.HasStoredDays.Should().Be(without.HasStoredDays);
        with.Stages.Should().Equal(without.Stages, "StageDefinition is unchanged: signs live on the stored stage rows only");
        with.Activities.Select(a => (a.ActivityName, a.OffsetDays, a.EndDay, a.Part)).Should()
            .Equal(without.Activities.Select(a => (a.ActivityName, a.OffsetDays, a.EndDay, a.Part)));
        with.Stage.Should().Be(without.Stage);
    }

    // ---- helpers --------------------------------------------------------------------------------------------------

    private static IEnumerable<string[]> LeafPaths(JsonNode node, string[]? prefix = null)
    {
        prefix ??= [];
        switch (node)
        {
            case JsonObject obj:
                foreach (var (key, value) in obj)
                {
                    if (value is null)
                    {
                        continue; // a null leaf cannot be mutated by text; the full sample sets every field, so none is null
                    }

                    foreach (var path in LeafPaths(value, [.. prefix, key]))
                    {
                        yield return path;
                    }
                }

                break;
            case JsonArray arr:
                for (var i = 0; i < arr.Count; i++)
                {
                    foreach (var path in LeafPaths(arr[i]!, [.. prefix, i.ToString()]))
                    {
                        yield return path;
                    }
                }

                break;
            default:
                yield return prefix;
                break;
        }
    }

    private static readonly Dictionary<string, string[]> EnumSwaps = new()
    {
        ["kind"] = ["observe", "work"],
        ["basis"] = ["assumed", "stated"],
        ["timing.timer"] = ["sign", "none"],
        ["timing.repeat"] = ["per_week", "every_n_days"],
    };

    private static void Mutate(JsonNode root, string[] path)
    {
        var node = root;
        for (var i = 0; i < path.Length - 1; i++)
        {
            node = node is JsonArray a ? a[int.Parse(path[i])]! : node[path[i]]!;
        }

        var last = path[^1];
        var current = node is JsonArray arr ? arr[int.Parse(last)]! : node[last]!;
        JsonNode replacement;
        var dotted = string.Join(".", path);
        if (EnumSwaps.TryGetValue(dotted, out var swaps))
        {
            replacement = swaps.First(w => w != current.GetValue<string>());
        }
        else if (current is JsonValue v && v.TryGetValue<string>(out var s))
        {
            replacement = s + "x";
        }
        else if (current is JsonValue n && n.TryGetValue<int>(out var number))
        {
            replacement = number + 1;
        }
        else
        {
            throw new InvalidOperationException($"unhandled leaf {dotted}");
        }

        if (node is JsonArray target)
        {
            target[int.Parse(last)] = replacement;
        }
        else
        {
            node[last] = replacement;
        }
    }
}
