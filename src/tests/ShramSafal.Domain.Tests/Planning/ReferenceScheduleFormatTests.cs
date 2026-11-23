// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7, "Reference schedules in the format: import, check, approve")
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Organizations;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// The rules of a reference schedule in FORMAT 2, without a database: an approval needs every task (and challenge) ticked on the SAME content hash; the maker of a
/// version never approves it; a next version starts unchecked; a dayless task never makes an adoptable sample; only the day tasks the old rules can hold reach an
/// old phone as stored activities. The real-Postgres twins (ReferenceScheduleRealPostgresTests) drive the same rules through the API as the application role.
/// </summary>
public sealed class ReferenceScheduleFormatTests
{
    private static readonly DateTime T0 = new(2026, 11, 23, 6, 0, 0, DateTimeKind.Utc);
    private static readonly UserId Maker = new(Guid.Parse("7e7e0000-0000-4000-8000-000000000001"));
    private static readonly UserId Checker = new(Guid.Parse("7e7e0000-0000-4000-8000-000000000002"));
    private const string Display = "श्रमसफल कृषी तज्ज्ञ चाचणी";

    private static readonly OwnScheduleStage[] Stages =
    [
        new("छाटणी आणि फूट", 0, 40),
        new("मण्यांची वाढ", 41, 99, EndSign: "काढणी"),
    ];

    /// <summary>One of every kind the old rules can and cannot hold: day once, day every N with an end, a day before pruning, dayless, after, sign, observe.</summary>
    internal static IReadOnlyList<ScheduleTaskContent> Tasks(string doseOfSpray = "२ ग्रॅम प्रति लिटर") =>
    [
        new("t-prune", "फळछाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(0), ScheduleBasis.Stated, 0, 0,
            Steps: ["काड्या ५-६ डोळ्यांवर छाटा"], Sources: [new ScheduleSource("चाचणी पुस्तिका", "३")]),
        new("t-spray", "बुरशीनाशक फवारणी", ScheduleTaskKind.Spray, ScheduleTaskTiming.OnDays(10, 30).Repeating(ScheduleRepeatMode.EveryNDays, 7), ScheduleBasis.Stated, 0, 1,
            Dose: doseOfSpray, Products: [new ScheduleProduct("चाचणी औषध", doseOfSpray, "ग्रॅम", "लिटर")], ReEntryHours: 24, PreHarvestDays: 30),
        new("t-pre", "छाटणीपूर्व पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.OnDays(-5), ScheduleBasis.Stated, 0, 2),
        new("t-dayless", "गरजेनुसार खत", ScheduleTaskKind.Nutrition, ScheduleTaskTiming.None("पानांचा रंग पाहून"), ScheduleBasis.Stated, 0, 3),
        new("t-after", "पेस्ट लावणे", ScheduleTaskKind.Work, ScheduleTaskTiming.AfterTask("t-prune", 1, 0, 2), ScheduleBasis.Stated, 0, 4),
        new("t-sign", "फुलोऱ्यात पाणी कमी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.WhenSeen("फुलोरा दिसला", 36, 50), ScheduleBasis.Stated, 1, 0),
        new("t-look", "मणी पाहणी", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(60, 62), ScheduleBasis.Stated, 1, 1,
            Look: new ScheduleTaskLook(Sign: "मण्यांचा आकार", IfThen: [new ScheduleIfThen("मणी लहान", "पाणी वाढवा")])),
    ];

    internal static IReadOnlyList<ScheduleChallengeContent> Challenges() =>
    [
        new("c-1", "डाऊनी", 0, 0, WhenWords: "पावसानंतर", Signs: "पानांवर पिवळे डाग", Action: "चाचणी कृती", Sources: [new ScheduleSource("चाचणी पुस्तिका", "९")]),
    ];

    internal static ScheduleTemplate Reference(
        ScheduleTemplate? previous = null, IReadOnlyList<ScheduleTaskContent>? tasks = null, UserId? maker = null,
        IReadOnlyList<OwnScheduleStage>? stages = null, IReadOnlyList<ScheduleChallengeContent>? challenges = null)
    {
        var template = ScheduleTemplate.ImportReference(
            Guid.NewGuid(), previous,
            new ReferenceScheduleImport("द्राक्ष: चाचणी संदर्भ", ScheduleOwnerType.Institution, "चाचणी पुस्तिका", "grape",
                stages ?? Stages, tasks ?? Tasks(), challenges ?? Challenges()),
            maker ?? Maker, T0, out var problem);
        Assert.Null(problem);
        return Assert.IsType<ScheduleTemplate>(template);
    }

    private static ScheduleCheckTicks AllTicks(ScheduleTemplate t, string? hash = null) =>
        new([], t.Tasks.Select(x => x.TaskKey).ToList(), t.Challenges.Select(x => x.ChallengeKey).ToList(), hash ?? t.TaskFormatHash());

    [Fact]
    public void Import_writes_the_tasks_whole_and_projects_only_the_day_tasks_an_old_phone_can_hold()
    {
        var reference = Reference();

        Assert.Equal(7, reference.Tasks.Count);
        Assert.Single(reference.Challenges);
        Assert.Equal(1, reference.Version);
        Assert.Equal(reference.Id, reference.ChainId);
        Assert.Equal(TenantScope.Public, reference.TenantScope);
        Assert.True(reference.IsInTaskFormat);
        Assert.Equal("काढणी", reference.StageRows.OrderBy(s => s.OrderIndex).Last().EndSign);

        // Projected: the pruning (day 0, once) and the spray (every 7 days, 10-30). Not projected: a day before pruning, the dayless, the after, the sign and
        // the observation (an old phone would print -5 as day 1 and give the dayless one an invented day).
        var projected = reference.ProjectedTaskKeyByActivity().Values.OrderBy(k => k, StringComparer.Ordinal).ToList();
        Assert.Equal(["t-prune", "t-spray"], projected);
        Assert.Equal(2, reference.Activities.Count);
        Assert.All(reference.Activities, a => Assert.True(a.OffsetDays >= 0));
        Assert.True(reference.HasStoredDays);
        Assert.NotNull(reference.TaskFormatHash());
    }

    [Fact]
    public void Approve_NeedsEveryTask_AndSameHash()
    {
        var reference = Reference();
        var hash = reference.TaskFormatHash()!;
        var allTasks = reference.Tasks.Select(t => t.TaskKey).ToList();
        var allChallenges = reference.Challenges.Select(c => c.ChallengeKey).ToList();

        // One task short: refused, with the count.
        var missingOne = ScheduleCheck.Approve(reference, new ScheduleCheckTicks([], allTasks.Skip(1).ToList(), allChallenges, hash), Checker, Display, T0, out var p1);
        Assert.Null(missingOne);
        Assert.Equal("ScheduleCheckNotAllTasks", p1!.Code);
        Assert.Contains("1 of 8", p1.Message);

        // Every task but no challenge: refused (a challenge's action is content too).
        var noChallenge = ScheduleCheck.Approve(reference, new ScheduleCheckTicks([], allTasks, [], hash), Checker, Display, T0, out var p2);
        Assert.Null(noChallenge);
        Assert.Equal("ScheduleCheckNotAllTasks", p2!.Code);

        // A key that is not of this version, or one ticked twice: refused.
        Assert.Null(ScheduleCheck.Approve(reference, new ScheduleCheckTicks([], [.. allTasks, "t-other"], allChallenges, hash), Checker, Display, T0, out var p3));
        Assert.Equal("ScheduleCheckNotAllTasks", p3!.Code);
        Assert.Null(ScheduleCheck.Approve(reference, new ScheduleCheckTicks([], [.. allTasks, allTasks[0]], allChallenges, hash), Checker, Display, T0, out _));

        // Every tick on ANOTHER hash (the content the checker saw is not this version's): refused; no hash at all: refused.
        var otherHash = Reference(tasks: Tasks("५ ग्रॅम प्रति लिटर")).TaskFormatHash()!;
        Assert.NotEqual(hash, otherHash);
        Assert.Null(ScheduleCheck.Approve(reference, AllTicks(reference, otherHash), Checker, Display, T0, out var p4));
        Assert.Equal("ScheduleCheckHashChanged", p4!.Code);
        Assert.Null(ScheduleCheck.Approve(reference, new ScheduleCheckTicks([], allTasks, allChallenges, null), Checker, Display, T0, out var p5));
        Assert.Equal("ScheduleCheckHashChanged", p5!.Code);

        // The old form (activity ids only) never approves a version in the task format.
        Assert.Null(ScheduleCheck.Approve(reference, reference.Activities.Select(a => a.Id).ToList(), Checker, Display, T0, out var p6));
        Assert.Equal("ScheduleCheckHashChanged", p6!.Code);

        // Every task and challenge on the same hash: Checked, and the record keeps every key and the hash.
        var check = ScheduleCheck.Approve(reference, AllTicks(reference), Checker, Display, T0, out var ok);
        Assert.Null(ok);
        Assert.NotNull(check);
        Assert.Equal(ScheduleCheckState.Checked, ScheduleCheck.StateOf([check!]));
        Assert.Equal(allTasks.OrderBy(k => k, StringComparer.Ordinal), check!.CheckedTaskKeys!);
        Assert.Equal(allChallenges, check.CheckedChallengeKeys!);
        Assert.Equal(hash, check.ContentHash);
        Assert.Equal(reference.Activities.Select(a => a.Id).OrderBy(i => i), check.CheckedActivityIds);
    }

    [Fact]
    public void The_content_hash_moves_with_any_field_of_any_task_challenge_stage_or_sign()
    {
        var baseHash = Reference().TaskFormatHash();
        Assert.Equal(baseHash, Reference().TaskFormatHash()); // the same content, new row ids: the same hash
        Assert.NotEqual(baseHash, Reference(tasks: Tasks("३ ग्रॅम प्रति लिटर")).TaskFormatHash());
        Assert.NotEqual(baseHash, Reference(challenges: [Challenges()[0] with { Action = "दुसरी कृती" }]).TaskFormatHash());
        Assert.NotEqual(baseHash, Reference(stages: [Stages[0], Stages[1] with { EndSign = "दुसरी खूण" }]).TaskFormatHash());
        Assert.NotEqual(baseHash, Reference(stages: [Stages[0] with { EndDay = 39 }, Stages[1] with { StartDay = 40 }]).TaskFormatHash());
    }

    [Fact]
    public void Maker_CannotApproveOwn()
    {
        var reference = Reference(maker: Maker);

        var own = ScheduleCheck.Approve(reference, AllTicks(reference), Maker, Display, T0, out var problem);
        Assert.Null(own);
        Assert.Equal(ScheduleCheck.OwnScheduleCode, problem!.Code);

        // The same rule for a row in the old form.
        var stored = ScheduleCheckTests.Stored();
        Assert.Null(ScheduleCheck.Approve(stored, stored.Activities.Select(a => a.Id).ToList(), stored.CreatedByUserId!.Value, Display, T0, out var oldForm));
        Assert.Equal(ScheduleCheck.OwnScheduleCode, oldForm!.Code);

        // The maker may still send it back with a reason (not an approval); another person approves it.
        Assert.NotNull(ScheduleCheck.Return(reference, "दुसरा डोस तपासा", Maker, Display, T0, out _));
        Assert.NotNull(ScheduleCheck.Approve(reference, AllTicks(reference), Checker, Display, T0, out var byOther));
        Assert.Null(byOther);
    }

    [Fact]
    public void NewVersion_StartsUnchecked()
    {
        var v1 = Reference();
        var approved = ScheduleCheck.Approve(v1, AllTicks(v1), Checker, Display, T0, out _)!;
        Assert.Equal(ScheduleCheckState.Checked, ScheduleCheck.StateOf([approved]));

        var v2 = Reference(previous: v1, tasks: Tasks("३ ग्रॅम प्रति लिटर"));
        Assert.Equal(2, v2.Version);
        Assert.Equal(v1.Id, v2.PreviousVersionId);
        Assert.Equal(v1.ChainId, v2.ChainId);
        Assert.NotEqual(v1.Id, v2.Id);

        // A check names one row: v1's approval says nothing about v2, which waits for its own (the listing reads the checks of v2's row: none).
        var checksOfV2 = new[] { approved }.Where(c => c.ScheduleTemplateId == v2.Id).ToList();
        Assert.Equal(ScheduleCheckState.NotChecked, ScheduleCheck.StateOf(checksOfV2));
        var listing = GetScheduleTemplatesHandler.Listing([v1, v2], [approved], ScheduleListingMode.Farm, new HashSet<Guid> { v1.Id, v2.Id });
        Assert.Contains(listing, d => d.Id == v1.Id && d.Check!.State == "Checked");
        Assert.DoesNotContain(listing, d => d.Id == v2.Id);
        var review = GetScheduleTemplatesHandler.Listing([v1, v2], [approved], ScheduleListingMode.Reviewer, new HashSet<Guid> { v1.Id, v2.Id });
        Assert.Equal("NotChecked", review.Single(d => d.Id == v2.Id).Check!.State);

        // v1's ticks do not approve v2 (its hash differs), and a gap may not shrink in a next version.
        Assert.Null(ScheduleCheck.Approve(v2, AllTicks(v1), Checker, Display, T0, out var stale));
        Assert.Equal("ScheduleCheckHashChanged", stale!.Code);
        var shrunk = Tasks().Select(t => t.TaskKey == "t-spray" ? t with { PreHarvestDays = 10 } : t).ToList();
        Assert.Null(ScheduleTemplate.ImportReference(Guid.NewGuid(), v1,
            new ReferenceScheduleImport("द्राक्ष: चाचणी संदर्भ", ScheduleOwnerType.Institution, null, "grape", Stages, shrunk, Challenges()), Maker, T0, out var gap));
        Assert.NotNull(gap);
    }

    [Fact]
    public void DaylessTask_NeverMakesAnAdoptableSample()
    {
        // A reference whose tasks are ALL dayless (and "after" / "sign"): no task stores a day, so no activity is written and the row stores no days.
        var dayless = Reference(tasks:
        [
            new("d-1", "गरजेनुसार खत", ScheduleTaskKind.Nutrition, ScheduleTaskTiming.None("पानांचा रंग पाहून"), ScheduleBasis.Stated),
            new("d-2", "फुलोऱ्यात पाणी कमी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.WhenSeen("फुलोरा दिसला"), ScheduleBasis.Stated),
        ]);
        Assert.Empty(dayless.Activities);
        Assert.False(dayless.HasStoredDays);
        var withTasks = new HashSet<Guid> { dayless.Id };

        // Unchecked: a farm caller is not offered it - not as a sample, not as the crop's default - while the built-in grape sample stays offered.
        var farm = GetScheduleTemplatesHandler.Listing([dayless], [], ScheduleListingMode.Farm, withTasks);
        Assert.DoesNotContain(farm, d => d.Id == dayless.Id);
        Assert.Contains(farm, d => d.CropType == "Grapes" && d.Scope is null);
        Assert.NotEqual(dayless.Id, GetScheduleTemplatesHandler.BuildCropTypes(farm).Single(c => c.Name == "Grapes").DefaultTemplateId);

        // In adoption's pool it is listed, but a NEW choice of it is closed (it is not a sample; it is an unchecked outside schedule).
        var pool = GetScheduleTemplatesHandler.Listing([dayless], [], ScheduleListingMode.Pool, withTasks);
        var row = pool.Single(d => d.Id == dayless.Id);
        Assert.True(row.HasTaskFormat);
        Assert.Equal("NotChecked", row.Check!.State);
        Assert.False(ScheduleLibrary.NewChoiceOpen(ScheduleOrigin.Outside, isBuiltIn: false, hasStoredDays: row.HasStoredDays == true || row.HasTaskFormat == true,
            ScheduleCheckState.NotChecked, cropHasChecked: false));

        // An old phone never sees it: its Stages are [] (release 1.0.17 drops a template with no stage) and no activity carries an invented day; the stage line
        // reaches a new phone through DraftStages.
        Assert.Empty(row.Stages);
        Assert.Empty(row.Activities);
        Assert.Equal(0, row.TotalDays);
        Assert.Equal(2, row.DraftStages!.Count);

        // Once checked by another person it is listed to a farm caller, still with no stage and no activity for an old phone.
        var approved = ScheduleCheck.Approve(dayless, AllTicks(dayless), Checker, Display, T0, out var problem);
        Assert.Null(problem);
        var checkedFarm = GetScheduleTemplatesHandler.Listing([dayless], [approved!], ScheduleListingMode.Farm, withTasks);
        var listed = checkedFarm.Single(d => d.Id == dayless.Id);
        Assert.Equal("Checked", listed.Check!.State);
        Assert.Empty(listed.Stages);
        Assert.Empty(listed.Activities);
    }
}
