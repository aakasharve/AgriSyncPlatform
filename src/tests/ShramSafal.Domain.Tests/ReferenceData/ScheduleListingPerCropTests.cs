// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-1F, register F114; founder D-91 = 1, D-82 = 3)
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.ReferenceData;

/// <summary>
/// The library lists "his visible rows PLUS the samples, by crop": a crop's samples (its built-in seeds plus its visible rows
/// without stored days) stay listed, marked NotChecked, until THAT crop has a Checked Outside schedule. His own rows never hide a
/// sample; a row waiting for its check is never listed to a farm caller.
/// </summary>
public sealed class ScheduleListingPerCropTests
{
    private static readonly DateTime T0 = new(2026, 11, 8, 6, 0, 0, DateTimeKind.Utc);
    private static readonly UserId Checker = new(Guid.Parse("c0c0c0c0-0000-4000-8000-000000000001"));
    private static readonly UserId Farmer = new(Guid.Parse("f0f0f0f0-0000-4000-8000-000000000001"));
    private const string Display = "श्रमसफल कृषी तज्ज्ञ चाचणी";
    private static readonly Guid[] BuiltInIds = ReferenceDataCatalog.ScheduleTemplates.Select(t => t.Id).ToArray();

    private static ScheduleTemplate Grape() => ScheduleCheckTests.Stored();

    private static ScheduleCheck Approved(ScheduleTemplate t) =>
        ScheduleCheck.Approve(t, t.Activities.Select(a => a.Id).ToList(), Checker, Display, T0.AddHours(1), out _)!;

    private static ScheduleTemplate Thin(string name, TenantScope scope = TenantScope.Public, UserId? maker = null)
    {
        var row = ScheduleTemplate.Create(Guid.NewGuid(), name, "Bahar Treatment", T0, maker, scope);
        row.AddActivity(Guid.NewGuid(), "Irrigation", 5);
        return row;
    }

    [Fact]
    public void Listing_keeps_a_crops_samples_until_that_crop_has_a_checked_schedule()
    {
        // One grape row he may see, waiting for its check: before the lane, Listing returned that row only (no pomegranate sample).
        var waitingGrape = Grape();

        var list = GetScheduleTemplatesHandler.Listing([waitingGrape], []);

        Assert.Contains(list, t => t.Id == BuiltInIds[1]); // pomegranate
        Assert.Contains(list, t => t.Id == BuiltInIds[0]); // grape sample: the grape row is not checked yet
        Assert.DoesNotContain(list, t => t.Id == waitingGrape.Id);
        Assert.All(list, t => Assert.Equal("NotChecked", t.Check!.State));
    }

    [Fact]
    public void His_own_visible_row_never_hides_the_samples()
    {
        var mine = Thin("Grapes - My copy", TenantScope.Private, Farmer);

        var list = GetScheduleTemplatesHandler.Listing([mine], []);

        Assert.Contains(list, t => t.Id == mine.Id);
        foreach (var id in BuiltInIds)
        {
            Assert.Contains(list, t => t.Id == id);
        }
    }

    [Fact]
    public void A_crop_with_a_checked_schedule_lists_its_checked_rows_and_his_own_rows_but_no_sample()
    {
        var grape = Grape();
        var mineOnGrapes = Thin("Grapes - My copy", TenantScope.Private, Farmer);
        var thinPublicGrape = Thin("Grapes - Old thin row");

        var list = GetScheduleTemplatesHandler.Listing([grape, mineOnGrapes, thinPublicGrape], [Approved(grape)]);

        Assert.Contains(list, t => t.Id == grape.Id && t.Check!.State == "Checked");
        Assert.Contains(list, t => t.Id == mineOnGrapes.Id);
        Assert.DoesNotContain(list, t => t.Id == BuiltInIds[0]);          // the grape built-in sample is gone
        Assert.DoesNotContain(list, t => t.Id == thinPublicGrape.Id);     // so is the grape thin row
        Assert.Contains(list, t => t.Id == BuiltInIds[1]);                // every other crop's samples stay
        Assert.Contains(list, t => t.Id == BuiltInIds[2]);
        Assert.Contains(list, t => t.Id == BuiltInIds[3]);
    }

    [Fact]
    public void An_imported_row_waiting_for_its_check_is_not_listed()
    {
        var waiting = Grape();

        var farm = GetScheduleTemplatesHandler.Listing([waiting], []);
        var reviewer = GetScheduleTemplatesHandler.Listing([waiting], [], ScheduleListingMode.Reviewer);

        Assert.DoesNotContain(farm, t => t.Id == waiting.Id);
        var row = Assert.Single(reviewer, t => t.Id == waiting.Id);
        Assert.Equal("NotChecked", row.Check!.State);
        Assert.Equal(true, row.HasStoredDays);
    }

    [Fact]
    public void A_thin_row_counts_as_a_sample_of_its_crop()
    {
        var thinGrape = Thin("Grapes - Old thin row");
        var checkedPomegranate = ScheduleTemplate.Import(
            Guid.NewGuid(), "Pomegranate - University Schedule", ScheduleOwnerType.Institution, "Test University", "pomegranate",
            Checker, TenantScope.Public, T0, [new("Bahar Treatment", 0, 30)],
            [new ImportedActivity("a", "Irrigation", 1, 2, FrequencyMode.OneTime, 1)], out var problem)!;
        Assert.Null(problem);

        var withoutChecked = GetScheduleTemplatesHandler.Listing([thinGrape], []);
        var pomegranateChecked = GetScheduleTemplatesHandler.Listing([thinGrape, checkedPomegranate], [Approved(checkedPomegranate)]);

        var thin = Assert.Single(withoutChecked, t => t.Id == thinGrape.Id);
        Assert.Equal("NotChecked", thin.Check!.State);
        // A checked schedule for ANOTHER crop does not hide the grape thin row.
        Assert.Contains(pomegranateChecked, t => t.Id == thinGrape.Id);
        Assert.DoesNotContain(pomegranateChecked, t => t.Id == BuiltInIds[1]);
        Assert.Contains(pomegranateChecked, t => t.Id == BuiltInIds[0]);
    }

    [Fact]
    public void Nothing_of_his_to_list_gives_the_four_built_in_samples_marked_NotChecked_with_the_catalog_hash()
    {
        var list = GetScheduleTemplatesHandler.Listing([], []);

        Assert.Equal(BuiltInIds.OrderBy(i => i), list.Select(t => t.Id).OrderBy(i => i));
        Assert.All(list, t =>
        {
            Assert.Equal("NotChecked", t.Check!.State);
            Assert.Equal(ReferenceDataCatalog.VersionHash, t.VersionHash);
        });
    }

    [Fact]
    public void A_withdrawn_row_is_listed_to_a_farm_caller_with_its_reason_but_does_not_hide_the_samples()
    {
        var grape = Grape();
        var approved = Approved(grape);
        var withdrawn = ScheduleCheck.Withdraw(grape, "Wrong dose in week 3", Checker, Display, T0.AddHours(2), out _)!;

        var list = GetScheduleTemplatesHandler.Listing([grape], [approved, withdrawn]);

        var row = Assert.Single(list, t => t.Id == grape.Id);
        Assert.Equal("Withdrawn", row.Check!.State);
        Assert.Equal("Wrong dose in week 3", row.Check.Note);
        Assert.Contains(list, t => t.Id == BuiltInIds[0]); // a withdrawn schedule is not a checked one
    }

    [Fact]
    public void The_list_hash_is_one_hash_over_the_whole_list()
    {
        var list = GetScheduleTemplatesHandler.Listing([Thin("Grapes - My copy", TenantScope.Private, Farmer)], []);

        Assert.Single(list.Select(t => t.VersionHash).Distinct());
    }
}
