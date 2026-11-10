// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN-c (founder D-137; R-c11, R-c12). The library listing of a person's own rows: the
// additive provenance fields (owner, typist, when, the version before), the made-for tags, and the hash rule - a tag is content and moves the list's
// hash; the owner and the maker are not content; a library with no tag hashes exactly as before the lane. Pure: no I/O.
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleListingMadeForTests
{
    private static readonly Guid RowId = Guid.Parse("c0c00000-0000-4000-8000-000000000001");
    private static readonly UserId OwnerA = new(Guid.Parse("a0a00000-0000-4000-8000-0000000000a1"));
    private static readonly UserId OwnerB = new(Guid.Parse("b0b00000-0000-4000-8000-0000000000b1"));
    private static readonly UserId Typist = new(Guid.Parse("a0a00000-0000-4000-8000-000000000012"));
    private static readonly DateTime Now = new(2026, 11, 10, 6, 0, 0, DateTimeKind.Utc);

    private static ScheduleTemplate Own(UserId owner, UserId maker, ScheduleMadeFor? tags = null) =>
        ScheduleTemplate.CreateOwn(RowId, "माझं द्राक्ष शेड्यूल", "Grapes", owner, maker, Now, tags);

    private static string HashOf(ScheduleTemplate row) => GetScheduleTemplatesHandler.Listing([row])[0].VersionHash;

    [Fact]
    public void A_made_for_tag_moves_the_library_hash_and_the_owner_and_maker_do_not()
    {
        var plain = HashOf(Own(OwnerA, OwnerA));

        HashOf(Own(OwnerA, OwnerA, new ScheduleMadeFor("Thompson Seedless", null, null, null))).Should().NotBe(plain, "a tag is content the phone must fetch");
        HashOf(Own(OwnerA, OwnerA, new ScheduleMadeFor(null, "black", null, null))).Should().NotBe(plain);
        HashOf(Own(OwnerB, OwnerA)).Should().Be(plain, "whose it is does not change what the phone lists");
        HashOf(Own(OwnerA, Typist)).Should().Be(plain, "nor who typed it");
    }

    [Fact]
    public void The_entry_carries_the_owner_the_typist_the_time_the_version_before_and_the_tags()
    {
        var v1 = Own(OwnerA, Typist, new ScheduleMadeFor("Thompson Seedless", "black", "mh_nashik", "dry"));
        var v2 = v1.EditCopyOnWrite(Guid.NewGuid(), "नवं", null, OwnerA, Now.AddMinutes(1));

        var listed = GetScheduleTemplatesHandler.Listing([v1, v2]).ToDictionary(t => t.Id);

        var e1 = listed[v1.Id];
        (e1.OwnerUserId, e1.MadeByUserId, e1.MadeAtUtc, e1.PreviousVersionId).Should().Be(((Guid?)OwnerA.Value, (Guid?)Typist.Value, (DateTime?)Now, (Guid?)null));
        (e1.Variety, e1.SoilType, e1.Region, e1.Climate).Should().Be(("Thompson Seedless", "black", "mh_nashik", "dry"));
        var e2 = listed[v2.Id];
        (e2.OwnerUserId, e2.MadeByUserId, e2.PreviousVersionId).Should().Be(((Guid?)OwnerA.Value, (Guid?)OwnerA.Value, (Guid?)v1.Id));
        e2.Variety.Should().Be("Thompson Seedless", "a rename carries the tags");
        e1.DraftStages.Should().BeNull("an empty version has no stage to draft");
        e1.Stages.Should().BeEmpty();
    }

    [Fact]
    public void A_version_with_stages_and_no_works_lists_no_stage_but_its_draft_stages()
    {
        var v2 = Own(OwnerA, OwnerA).EditCopyOnWrite(
            Guid.NewGuid(), null, null, [new("Pruning", 0, 20), new("Growth", 21, 60)], [], OwnerA, Now, out var problem)!;
        problem.Should().BeNull();

        var entry = GetScheduleTemplatesHandler.Listing([v2]).Single(t => t.Id == v2.Id);

        entry.Stages.Should().BeEmpty("M004: 1.0.17 lists any template with a stage and would churn on adopting one it can never follow");
        entry.TotalDays.Should().Be(0);
        entry.HasStoredDays.Should().BeFalse();
        entry.DraftStages.Should().NotBeNull();
        entry.DraftStages!.Select(s => (s.Name, s.StartDay, s.EndDay)).Should().Equal(("Pruning", 0, 20), ("Growth", 21, 60));
    }

    [Fact]
    public void A_Public_row_lists_its_tags_but_not_its_maker_and_a_row_with_days_keeps_them_too()
    {
        var pub = ScheduleTemplate.Create(RowId, "Grapes - public", "Pruning", Now, Typist, TenantScope.Public);
        var listedPublic = GetScheduleTemplatesHandler.Listing([pub]).Single(t => t.Id == RowId);
        (listedPublic.OwnerUserId, listedPublic.MadeByUserId, listedPublic.MadeAtUtc, listedPublic.PreviousVersionId)
            .Should().Be(((Guid?)null, (Guid?)null, (DateTime?)null, (Guid?)null), "least exposure: a Public import's maker is staff");

        var withDays = Own(OwnerA, OwnerA, new ScheduleMadeFor(null, null, "mh_pune", null)).EditCopyOnWrite(
            Guid.NewGuid(), null, null, [new("Pruning", 0, 20)], [new("Drip", "irrigation", null, 0, 10, FrequencyMode.EveryNDays, 3)], Typist, Now, out _,
            madeFor: new ScheduleMadeFor(null, null, "mh_pune", "hot"))!;
        var listedDays = GetScheduleTemplatesHandler.Listing([withDays]).Single(t => t.Id == withDays.Id);
        listedDays.HasStoredDays.Should().BeTrue();
        (listedDays.Region, listedDays.Climate, listedDays.OwnerUserId, listedDays.MadeByUserId).Should().Be(("mh_pune", "hot", (Guid?)OwnerA.Value, (Guid?)Typist.Value));
        listedDays.DraftStages.Should().BeNull("a version that stores its days lists its stages as stages");
    }
}
