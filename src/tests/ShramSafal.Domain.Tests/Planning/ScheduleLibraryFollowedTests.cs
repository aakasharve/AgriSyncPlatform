// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN-c fix round 1 (review P001). What the pull carries for a schedule a plot ALREADY follows
// (ScheduleLibrary.FollowedAsync) is the SAME entry the full mapping gives for that id: the visibility filter may change who receives a row, never the input to
// the mapping - a thin row's stages and totalDays are an equal split over every thin row of its crop in that input. Pure: a fake repository, no I/O.
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleLibraryFollowedTests
{
    private static readonly DateTime Now = new(2026, 11, 10, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Reader = Guid.Parse("a0a00000-0000-4000-8000-000000000021");
    private static readonly Guid OtherOwner = Guid.Parse("a0a00000-0000-4000-8000-000000000022");

    private sealed class Repo : FakeShramSafalRepository, IShramSafalRepository
    {
        /// <summary>Rows the viewer may walk to (the version before an edit), by id.</summary>
        public Dictionary<Guid, ScheduleTemplate> Templates { get; } = [];

        public override Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) =>
            Task.FromResult(Templates.GetValueOrDefault(templateId));

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => Task.FromResult<Farm?>(null);

        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => Task.FromResult(new List<Guid>());

        public Task<IReadOnlyList<ScheduleCheck>> GetScheduleChecksAsync(IReadOnlyCollection<Guid> ids, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ScheduleCheck>>([]);
    }

    /// <summary>A thin Public sample of Grapes (no stored days): its stage and the offsets of its works feed the crop's equal split.</summary>
    private static ScheduleTemplate Thin(string name, string stage, params int[] offsets)
    {
        var row = ScheduleTemplate.Create(Guid.NewGuid(), name, stage, Now);
        foreach (var offset in offsets)
        {
            row.AddActivity(Guid.NewGuid(), "Drip Irrigation", offset, FrequencyMode.EveryNDays, 3);
        }

        return row;
    }

    /// <summary>Another owner's own schedule that stores its days: a Team row the reader's viewer does not show.</summary>
    private static ScheduleTemplate OthersOwnWithDays(Repo repo)
    {
        var empty = ScheduleTemplate.CreateOwn(Guid.NewGuid(), "दुसऱ्याचं", "Grapes", new UserId(OtherOwner), new UserId(OtherOwner), Now);
        repo.Templates[empty.Id] = empty;
        return empty.EditCopyOnWrite(
            Guid.NewGuid(), null, null,
            [new("Pruning", 0, 20), new("Growth", 21, 60)],
            [new("ठिबक सिंचन", "irrigation", null, 0, 20, FrequencyMode.EveryNDays, 3)],
            new UserId(OtherOwner), Now, out _)!;
    }

    private static ScheduleTemplateDto Entry(IEnumerable<ScheduleTemplateDto> listing, Guid id) => listing.Single(t => t.Id == id);

    [Fact]
    public async Task A_followed_thin_sample_arrives_with_the_stages_and_totalDays_the_full_listing_gives_it()
    {
        var postPruning = Thin("Grapes - Post Pruning", "Pruning", 0, 7);
        var flowering = Thin("Grapes - Flowering", "Flowering", 90);
        IReadOnlyList<ScheduleTemplate> rows = [postPruning, flowering];
        var full = Entry(GetScheduleTemplatesHandler.Listing(rows, [], ScheduleListingMode.Pool), postPruning.Id);
        full.Stages.Should().HaveCount(2, "not vacuous: the equal split spans both thin rows of the crop");
        full.TotalDays.Should().Be(120);

        var followed = await ScheduleLibrary.FollowedAsync(new Repo(), rows, Reader, [postPruning.Id]);

        followed.Should().ContainSingle().Which.Should().BeEquivalentTo(full, "the same entry the full mapping gives for that id (P3, P4, R7)");
    }

    [Fact]
    public async Task A_followed_row_the_viewer_would_not_show_is_still_mapped_over_the_full_visible_set_plus_itself()
    {
        var postPruning = Thin("Grapes - Post Pruning", "Pruning", 0, 7);
        var flowering = Thin("Grapes - Flowering", "Flowering", 90);
        var repo = new Repo();
        var others = OthersOwnWithDays(repo);
        IReadOnlyList<ScheduleTemplate> rows = [postPruning, flowering, others];
        var expected = GetScheduleTemplatesHandler.Listing(rows, [], ScheduleListingMode.Pool);

        var followed = await ScheduleLibrary.FollowedAsync(repo, rows, Reader, [postPruning.Id, others.Id]);

        followed.Select(t => t.Id).Should().BeEquivalentTo([postPruning.Id, others.Id], "the extra of a row he may not see still reaches him (R-c9)");
        Entry(followed, postPruning.Id).Should().BeEquivalentTo(Entry(expected, postPruning.Id));
        Entry(followed, others.Id).Should().BeEquivalentTo(Entry(expected, others.Id));
    }

    [Fact]
    public async Task A_followed_built_in_sample_and_an_unknown_id_behave_as_before()
    {
        var builtIn = ReferenceDataCatalog.ScheduleTemplates[0].Id;
        var thin = Thin("Grapes - Post Pruning", "Pruning", 0, 7);

        var followed = await ScheduleLibrary.FollowedAsync(new Repo(), [thin], Reader, [builtIn, Guid.NewGuid()]);

        followed.Should().ContainSingle().Which.Id.Should().Be(builtIn, "a followed built-in sample (no row) is carried; an unknown id is not");
    }
}
