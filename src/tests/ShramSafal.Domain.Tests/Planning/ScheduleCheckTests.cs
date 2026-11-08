// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-A, Tasks 2 and 4; founder D-74, L8-R)
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Organizations;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// The schedule check's truth table (Task 2) and the import's order rules (Task 4, R34). A check is a ShramSafal PLATFORM
/// act: an append-only record of who, when and which version; only a row whose days are STORED can be checked (R3/P4), and
/// Approve needs EVERY activity ticked (R4).
/// </summary>
public sealed class ScheduleCheckTests
{
    private static readonly DateTime T0 = new(2026, 11, 8, 6, 0, 0, DateTimeKind.Utc);
    private static readonly UserId Checker = new(Guid.Parse("c0c0c0c0-0000-4000-8000-000000000001"));
    private const string Display = "श्रमसफल कृषी तज्ज्ञ Test";

    private static readonly StageDefinition[] Stages =
    [
        new("Post Pruning", 0, 15),
        new("Canopy Build", 16, 35),
    ];

    private static ImportedActivity Act(
        string key, string name, int start, int end, FrequencyMode mode = FrequencyMode.OneTime, int interval = 1,
        string? after = null, string? role = null) => new(key, name, start, end, mode, interval, after, role);

    internal static ScheduleTemplate Stored(params ImportedActivity[] activities)
    {
        var template = ScheduleTemplate.Import(
            Guid.NewGuid(), "Grapes - University Schedule", ScheduleOwnerType.Institution, "Test University", "grape",
            Checker, TenantScope.Public, T0, Stages,
            activities.Length == 0
                ? [Act("a", "Pruning", 0, 1), Act("b", "Foliar Spray", 18, 35, FrequencyMode.EveryNDays, 7)]
                : activities,
            out var problem);
        Assert.Null(problem);
        return Assert.IsType<ScheduleTemplate>(template);
    }

    private static IReadOnlyList<Guid> AllIds(ScheduleTemplate t) => t.Activities.Select(a => a.Id).ToList();

    [Fact]
    public void Every_activity_ticked_is_Checked()
    {
        var template = Stored();
        var check = ScheduleCheck.Approve(template, AllIds(template), Checker, Display, T0.AddHours(1), out var problem);

        Assert.Null(problem);
        Assert.NotNull(check);
        Assert.Equal(ScheduleCheckDecision.Approved, check!.Decision);
        Assert.Equal(template.Id, check.ScheduleTemplateId);
        Assert.Equal(template.Version, check.TemplateVersion);
        Assert.Equal(Checker, check.CheckerUserId);
        Assert.Equal(AllIds(template).OrderBy(i => i), check.CheckedActivityIds.OrderBy(i => i));
        Assert.Equal(ScheduleCheckState.Checked, ScheduleCheck.StateOf([check]));
    }

    [Fact]
    public void One_missing_tick_is_refused()
    {
        var template = Stored();
        var ids = AllIds(template).Take(1).ToList();

        var check = ScheduleCheck.Approve(template, ids, Checker, Display, T0, out var problem);

        Assert.Null(check);
        Assert.Equal("ScheduleCheckNotAllRows", problem!.Code);
    }

    [Fact]
    public void A_tick_for_an_activity_of_another_row_is_refused()
    {
        var template = Stored();
        var ids = AllIds(template).Take(1).Append(Guid.NewGuid()).ToList();

        Assert.Null(ScheduleCheck.Approve(template, ids, Checker, Display, T0, out var problem));
        Assert.Equal("ScheduleCheckNotAllRows", problem!.Code);
    }

    [Fact]
    public void A_row_without_stored_days_is_refused_for_every_decision()
    {
        // A row made the old way: stages and activities with no stored end day, repeat or part.
        var thin = ScheduleTemplate.Create(Guid.NewGuid(), "Grapes - Old", "Post Pruning", T0, Checker, TenantScope.Public, Stages);
        thin.AddActivity(Guid.NewGuid(), "Pruning", 0);
        Assert.False(thin.HasStoredDays);

        Assert.Null(ScheduleCheck.Approve(thin, AllIds(thin), Checker, Display, T0, out var p1));
        Assert.Equal("ScheduleCheckDaysNotStored", p1!.Code);
        Assert.Null(ScheduleCheck.Return(thin, "why", Checker, Display, T0, out var p2));
        Assert.Equal("ScheduleCheckDaysNotStored", p2!.Code);
        Assert.Null(ScheduleCheck.Withdraw(thin, "why", Checker, Display, T0, out var p3));
        Assert.Equal("ScheduleCheckDaysNotStored", p3!.Code);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Return_and_Withdraw_without_a_note_are_refused(string? note)
    {
        var template = Stored();

        Assert.Null(ScheduleCheck.Return(template, note, Checker, Display, T0, out var returned));
        Assert.Equal("ScheduleCheckNoteRequired", returned!.Code);
        Assert.Null(ScheduleCheck.Withdraw(template, note, Checker, Display, T0, out var withdrawn));
        Assert.Equal("ScheduleCheckNoteRequired", withdrawn!.Code);
    }

    [Fact]
    public void Return_and_Withdraw_with_a_note_are_recorded_with_the_note()
    {
        var template = Stored();

        var returned = ScheduleCheck.Return(template, " day 18 spray is too early ", Checker, Display, T0, out var p1);
        var withdrawn = ScheduleCheck.Withdraw(template, "source revised", Checker, Display, T0.AddMinutes(1), out var p2);

        Assert.Null(p1);
        Assert.Null(p2);
        Assert.Equal("day 18 spray is too early", returned!.Note);
        Assert.Empty(returned.CheckedActivityIds);
        Assert.Equal(ScheduleCheckState.Returned, ScheduleCheck.StateOf([returned]));
        Assert.Equal(ScheduleCheckState.Withdrawn, ScheduleCheck.StateOf([withdrawn!]));
    }

    [Fact]
    public void A_check_needs_the_checker_and_the_name_farmers_read()
    {
        var template = Stored();

        Assert.Null(ScheduleCheck.Approve(template, AllIds(template), new UserId(Guid.Empty), Display, T0, out var noUser));
        Assert.Equal("ScheduleCheckChecker", noUser!.Code);
        Assert.Null(ScheduleCheck.Approve(template, AllIds(template), Checker, "  ", T0, out var noName));
        Assert.Equal("ScheduleCheckDisplayName", noName!.Code);
    }

    [Fact]
    public void The_latest_decision_for_a_row_wins()
    {
        var template = Stored();
        var approved = ScheduleCheck.Approve(template, AllIds(template), Checker, Display, T0.AddHours(1), out _)!;
        var withdrawn = ScheduleCheck.Withdraw(template, "source revised", Checker, Display, T0.AddHours(2), out _)!;
        var approvedAgain = ScheduleCheck.Approve(template, AllIds(template), Checker, Display, T0.AddHours(3), out _)!;

        Assert.Equal(ScheduleCheckState.NotChecked, ScheduleCheck.StateOf([]));
        Assert.Equal(ScheduleCheckState.Checked, ScheduleCheck.StateOf([approved]));
        Assert.Equal(ScheduleCheckState.Withdrawn, ScheduleCheck.StateOf([approved, withdrawn]));
        // The order the rows are given in does not matter: the latest by time wins.
        Assert.Equal(ScheduleCheckState.Withdrawn, ScheduleCheck.StateOf([withdrawn, approved]));
        Assert.Equal(ScheduleCheckState.Checked, ScheduleCheck.StateOf([approved, withdrawn, approvedAgain]));
    }

    [Fact]
    public void Editing_a_checked_schedule_gives_a_new_row_NotChecked_and_the_old_row_stays_Checked()
    {
        // Review Focus 6: a checked schedule is edited later -> farmers on the checked version keep it with its badge; the
        // edited copy is a new row that reads NotChecked until it is checked again.
        var template = Stored();
        var check = ScheduleCheck.Approve(template, AllIds(template), Checker, Display, T0.AddHours(1), out _)!;

        var edited = template.EditCopyOnWrite(Guid.NewGuid(), "Grapes - University Schedule (rev)", null, Checker, T0.AddDays(1));

        Assert.NotEqual(template.Id, edited.Id);
        Assert.Equal(2, edited.Version);
        Assert.True(edited.HasStoredDays);
        var checks = new[] { check };
        Assert.Equal(ScheduleCheckState.Checked, ScheduleCheck.StateOf(checks.Where(c => c.ScheduleTemplateId == template.Id)));
        Assert.Equal(ScheduleCheckState.NotChecked, ScheduleCheck.StateOf(checks.Where(c => c.ScheduleTemplateId == edited.Id)));

        // A tick list of the OLD row's activity ids cannot approve the NEW row (the copy mints new activity ids).
        Assert.Null(ScheduleCheck.Approve(edited, AllIds(template), Checker, Display, T0, out var problem));
        Assert.Equal("ScheduleCheckNotAllRows", problem!.Code);
    }

    // ── Task 4 (round 3, R34): the order between two once-only works ──

    [Fact]
    public void An_order_between_two_once_only_works_is_stored_on_the_second()
    {
        var template = Stored(
            Act("cut", "Pruning", 0, 1),
            Act("paste", "Paste", 2, 3, after: "cut"),
            Act("spray", "Foliar Spray", 18, 35, FrequencyMode.EveryNDays, 7));

        var cut = template.Activities.Single(a => a.ActivityName == "Pruning");
        var paste = template.Activities.Single(a => a.ActivityName == "Paste");
        Assert.Null(cut.AfterActivityId);
        Assert.Equal(cut.Id, paste.AfterActivityId);
        Assert.True(template.HasStoredDays);
    }

    public static IEnumerable<object[]> RefusedOrders()
    {
        // outside the row
        yield return new object[]
        {
            new[] { Act("a", "Pruning", 0, 1), Act("b", "Paste", 2, 3, after: "ghost") },
        };
        // from a repeated work
        yield return new object[]
        {
            new[] { Act("a", "Pruning", 0, 1), Act("b", "Foliar Spray", 18, 35, FrequencyMode.EveryNDays, 7, after: "a") },
        };
        // to a repeated work
        yield return new object[]
        {
            new[] { Act("a", "Foliar Spray", 18, 35, FrequencyMode.EveryNDays, 7), Act("b", "Paste", 2, 3, after: "a") },
        };
        // itself
        yield return new object[] { new[] { Act("a", "Pruning", 0, 1, after: "a") } };
        // a loop
        yield return new object[]
        {
            new[] { Act("a", "Pruning", 0, 1, after: "b"), Act("b", "Paste", 2, 3, after: "a") },
        };
    }

    [Theory]
    [MemberData(nameof(RefusedOrders))]
    public void An_order_to_another_rows_activity_or_from_a_repeated_work_or_a_loop_is_refused_with_words(ImportedActivity[] activities)
    {
        var template = ScheduleTemplate.Import(
            Guid.NewGuid(), "Grapes", ScheduleOwnerType.Institution, null, "grape", Checker, TenantScope.Public, T0, Stages,
            activities, out var problem);

        Assert.Null(template);
        Assert.Equal("ScheduleImportOrder", problem!.Code);
        Assert.False(string.IsNullOrWhiteSpace(problem.Message));
    }

    [Fact]
    public void An_edit_keeps_the_order_on_the_new_version()
    {
        var template = Stored(Act("cut", "Pruning", 0, 1), Act("paste", "Paste", 2, 3, after: "cut"));

        var edited = template.EditCopyOnWrite(Guid.NewGuid(), null, null, Checker, T0.AddDays(1));

        AssertOrderRemapped(template, edited);
    }

    [Fact]
    public void A_clone_remaps_the_order_to_the_new_activity_ids()
    {
        var template = Stored(Act("cut", "Pruning", 0, 1), Act("paste", "Paste", 2, 3, after: "cut"));

        var clone = template.Clone(Guid.NewGuid(), Checker, TenantScope.Private, "my copy", T0.AddDays(1));

        AssertOrderRemapped(template, clone);
        Assert.Equal(ScheduleOwnerType.User, clone.OwnerType);
        Assert.Equal(template.CropKey, clone.CropKey);
    }

    private static void AssertOrderRemapped(ScheduleTemplate source, ScheduleTemplate copy)
    {
        var oldIds = source.Activities.Select(a => a.Id).ToHashSet();
        var newCut = copy.Activities.Single(a => a.ActivityName == "Pruning");
        var newPaste = copy.Activities.Single(a => a.ActivityName == "Paste");

        Assert.DoesNotContain(newCut.Id, oldIds);
        Assert.DoesNotContain(newPaste.Id, oldIds);
        Assert.Equal(newCut.Id, newPaste.AfterActivityId);
        // The stored days and the role travel with the copy.
        Assert.True(copy.HasStoredDays);
        Assert.Equal(source.Activities.Single(a => a.ActivityName == "Paste").OperationKey, newPaste.OperationKey);
        Assert.Equal(source.Stages.Count, copy.Stages.Count);
    }

    [Fact]
    public void Role_is_proposed_at_import_and_stored()
    {
        var template = Stored(
            Act("f", "बुरशीनाशक फवारणी", 18, 35, FrequencyMode.EveryNDays, 7),
            Act("i", "कीटकनाशक फवारणी", 18, 35, FrequencyMode.EveryNDays, 10),
            Act("b", "बोरॉन फवारणी", 20, 20),
            Act("n", "विद्राव्य खत 0:52:34 (ठिबकातून)", 21, 30, FrequencyMode.PerWeek, 2),
            Act("o", "Pruning", 0, 1, role: null));

        Assert.Equal("fungicide", Named(template, "बुरशीनाशक फवारणी").Role);
        Assert.Equal("insecticide", Named(template, "कीटकनाशक फवारणी").Role);
        var boron = Named(template, "बोरॉन फवारणी");
        Assert.Equal("nutrient", boron.Role);
        Assert.Equal("boron", boron.NutrientKey);
        var npk = Named(template, "विद्राव्य खत 0:52:34 (ठिबकातून)");
        Assert.Equal("nutrient", npk.Role);
        Assert.Equal("npk-0-52-34", npk.NutrientKey);
        Assert.Equal("Spray", Named(template, "बुरशीनाशक फवारणी").Part);
        Assert.Null(Named(template, "Pruning").Role);
        // W003: the operation key is WORK-ID's, never a new spelling.
        Assert.StartsWith("op_", Named(template, "Pruning").OperationKey);
    }

    [Fact]
    public void A_stated_role_wins_over_the_proposal_and_an_unknown_role_is_refused()
    {
        var stated = Stored(Act("a", "फवारणी", 18, 35, FrequencyMode.EveryNDays, 7, role: "Insecticide"));
        Assert.Equal("insecticide", stated.Activities.Single().Role);

        var refused = ScheduleTemplate.Import(
            Guid.NewGuid(), "Grapes", ScheduleOwnerType.Expert, null, null, Checker, TenantScope.Public, T0, Stages,
            [Act("a", "फवारणी", 18, 35, FrequencyMode.EveryNDays, 7, role: "weedkiller")], out var problem);
        Assert.Null(refused);
        Assert.Equal("ScheduleImportRole", problem!.Code);
    }

    private static TemplateActivity Named(ScheduleTemplate t, string name) => t.Activities.Single(a => a.ActivityName == name);

    [Fact]
    public void End_before_start_and_an_activity_outside_every_stage_are_refused_with_words()
    {
        var endBeforeStart = ScheduleTemplate.Import(
            Guid.NewGuid(), "Grapes", ScheduleOwnerType.Institution, null, null, Checker, TenantScope.Public, T0, Stages,
            [Act("a", "Pruning", 10, 5)], out var p1);
        Assert.Null(endBeforeStart);
        Assert.Equal("ScheduleImportActivityDays", p1!.Code);

        var outside = ScheduleTemplate.Import(
            Guid.NewGuid(), "Grapes", ScheduleOwnerType.Institution, null, null, Checker, TenantScope.Public, T0, Stages,
            [Act("a", "Pruning", 90, 91)], out var p2);
        Assert.Null(outside);
        Assert.Equal("ScheduleImportOutsideStages", p2!.Code);

        var badStage = ScheduleTemplate.Import(
            Guid.NewGuid(), "Grapes", ScheduleOwnerType.Institution, null, null, Checker, TenantScope.Public, T0,
            [new StageDefinition("Bad", 9, 3)], [Act("a", "Pruning", 4, 5)], out var p3);
        Assert.Null(badStage);
        Assert.Equal("ScheduleImportStageDays", p3!.Code);
    }

    [Fact]
    public void The_stage_of_an_activity_is_the_stage_that_holds_its_first_day()
    {
        var template = Stored(Act("a", "Pruning", 0, 1), Act("b", "Foliar Spray", 18, 35, FrequencyMode.EveryNDays, 7));

        Assert.Equal("Post Pruning", template.StageContaining(0)!.Name);
        Assert.Equal("Canopy Build", template.StageContaining(18)!.Name);
        Assert.Null(template.StageContaining(99));
    }

    // ── Task 3: the matrix (the real-Postgres matrix proves the 200/403; this pins the rule itself) ──

    [Theory]
    [InlineData(OrganizationType.Platform, OrganizationRole.Owner, true, true)]
    [InlineData(OrganizationType.Platform, OrganizationRole.Employee, true, true)]
    [InlineData(OrganizationType.Platform, OrganizationRole.Analyst, true, false)]
    [InlineData(OrganizationType.Platform, OrganizationRole.Auditor, false, false)]
    [InlineData(OrganizationType.Platform, OrganizationRole.Viewer, false, false)]
    [InlineData(OrganizationType.FPO, OrganizationRole.Owner, false, false)]
    [InlineData(OrganizationType.FPC, OrganizationRole.Owner, false, false)]
    [InlineData(OrganizationType.ConsultingFirm, OrganizationRole.Owner, false, false)]
    [InlineData(OrganizationType.Lab, OrganizationRole.Owner, false, false)]
    public void ScheduleReview_is_a_platform_module(OrganizationType type, OrganizationRole role, bool read, bool write)
    {
        var entitlement = EntitlementMatrix.For(type, role).Single(e => e.ModuleKey == ModuleKey.ScheduleReview);

        Assert.Equal(read, entitlement.CanRead);
        Assert.Equal(write, entitlement.CanWrite);
        Assert.False(entitlement.CanExport);
    }
}
