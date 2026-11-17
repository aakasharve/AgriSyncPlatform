// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146; P11, P6)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Pictures;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Pictures;

/// <summary>
/// What the PULL says each schedule shows to each reader: the three optional fields, decided on the server by seat. The owner sees his own;
/// a seat that reads other people's records on his farm sees the schedule picture and his face; a seat that reads only its own records sees no
/// face but does see a schedule picture or a logo; another farm sees only an outside schedule's institution logo.
/// </summary>
public sealed class SchedulePictureAttacherTests
{
    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly Guid CoOwner = Guid.NewGuid();
    private static readonly Guid Worker = Guid.NewGuid();
    private static readonly Guid Stranger = Guid.NewGuid();
    private static readonly Guid OwnerFarm = Guid.NewGuid();
    private static readonly Guid StrangerFarm = Guid.NewGuid();

    private readonly PictureRepo _repo = new();
    private readonly MemoryPictureStore _store = new();

    public SchedulePictureAttacherTests()
    {
        _repo.Farms[OwnerFarm] = PictureTestKit.FarmOwnedBy(OwnerFarm, Owner);
        _repo.Farms[StrangerFarm] = PictureTestKit.FarmOwnedBy(StrangerFarm, Stranger);
    }

    private static ScheduleTemplateDto Dto(ScheduleTemplate row) => new(
        row.Id, row.Name, "Grapes", 0, [], [], "h",
        Scope: row.TenantScope.ToString(),
        OwnerUserId: row.TenantScope == TenantScope.Public ? null : row.OwnerUserId?.Value,
        MadeByUserId: row.TenantScope == TenantScope.Public ? null : row.CreatedByUserId?.Value,
        PreviousVersionId: row.TenantScope == TenantScope.Public ? null : row.PreviousVersionId);

    private async Task<IReadOnlyList<ScheduleTemplateDto>> PullAs(Guid reader, IEnumerable<FarmReadScope> seats, params ScheduleTemplateDto[] listing) =>
        await SchedulePictureAttacher.AttachAsync(_repo, _store, reader, seats, listing);

    private Picture Put(PictureKind kind, Guid subject, Guid setBy, byte fill)
    {
        var picture = PictureTestKit.PictureOf(kind, subject, setBy, fill);
        _store.Rows.Add(picture);
        return picture;
    }

    private (ScheduleTemplate Root, ScheduleTemplate Latest) OwnChain()
    {
        var root = PictureTestKit.OwnSchedule(Guid.NewGuid(), Owner);
        var v2 = root.EditCopyOnWrite(Guid.NewGuid(), null, null, new UserId(CoOwner), PictureTestKit.Now);
        _repo.Templates[root.Id] = root;
        _repo.Templates[v2.Id] = v2;
        return (root, v2);
    }

    private static void AssertShows(ScheduleTemplateDto dto, Picture expected)
    {
        dto.PictureId.Should().Be(expected.Id);
        dto.PictureSha256.Should().Be(expected.Sha256);
        dto.PictureKind.Should().Be(PictureKinds.ToWire(expected.Kind));
    }

    private static void AssertShowsNothing(ScheduleTemplateDto dto)
    {
        dto.PictureId.Should().BeNull();
        dto.PictureSha256.Should().BeNull();
        dto.PictureKind.Should().BeNull();
    }

    [Fact]
    public async Task The_schedule_picture_shows_on_every_version_because_it_hangs_on_the_root()
    {
        var (root, latest) = OwnChain();
        var picture = Put(PictureKind.Schedule, root.Id, Owner, 1);
        Put(PictureKind.Person, Owner, Owner, 2);

        var result = await PullAs(Owner, [], Dto(root), Dto(latest));

        AssertShows(result[0], picture);
        AssertShows(result[1], picture);
    }

    [Fact]
    public async Task Without_a_schedule_picture_the_owner_sees_his_own_face_on_his_schedules()
    {
        var (root, latest) = OwnChain();
        var face = Put(PictureKind.Person, Owner, Owner, 2);

        var result = await PullAs(Owner, [], Dto(root), Dto(latest));

        AssertShows(result[0], face);
        AssertShows(result[1], face);
    }

    [Fact]
    public async Task A_co_owner_with_a_seat_that_reads_the_farm_sees_the_schedule_picture_and_the_owners_face()
    {
        var (root, latest) = OwnChain();
        var face = Put(PictureKind.Person, Owner, Owner, 2);
        _repo.OverrideFarmsOf(CoOwner, OwnerFarm);
        var seats = new[] { PictureTestKit.Seat(OwnerFarm, ownRecordsOnly: false) };

        var plain = await PullAs(CoOwner, seats, Dto(root), Dto(latest));
        AssertShows(plain[0], face);

        var logo = Put(PictureKind.Schedule, root.Id, Owner, 1);
        var withLogo = await PullAs(CoOwner, seats, Dto(root), Dto(latest));
        AssertShows(withLogo[0], logo);
        AssertShows(withLogo[1], logo);
    }

    [Fact]
    public async Task A_worker_on_an_own_records_seat_gets_no_face_but_does_get_a_schedule_picture()
    {
        var (root, latest) = OwnChain();
        Put(PictureKind.Person, Owner, Owner, 2);
        _repo.OverrideFarmsOf(Worker, OwnerFarm);
        var seats = new[] { PictureTestKit.Seat(OwnerFarm, ownRecordsOnly: true) };

        var noFace = await PullAs(Worker, seats, Dto(root), Dto(latest));
        AssertShowsNothing(noFace[0]);
        AssertShowsNothing(noFace[1]);

        var logo = Put(PictureKind.Schedule, root.Id, Owner, 1);
        var withLogo = await PullAs(Worker, seats, Dto(root), Dto(latest));
        AssertShows(withLogo[0], logo);
    }

    [Fact]
    public async Task A_seat_that_reads_records_on_another_farm_does_not_unlock_this_owners_face()
    {
        // the worker's seat is own-records-only on the OWNER's farm, but he is a full seat on his OWN farm: that gives him no right to the owner's face
        var (root, _) = OwnChain();
        Put(PictureKind.Person, Owner, Owner, 2);
        _repo.OverrideFarmsOf(Worker, OwnerFarm, StrangerFarm);
        var seats = new[] { PictureTestKit.Seat(OwnerFarm, ownRecordsOnly: true), PictureTestKit.Seat(StrangerFarm, ownRecordsOnly: false) };

        var result = await PullAs(Worker, seats, Dto(root));

        AssertShowsNothing(result[0]);
    }

    [Fact]
    public async Task A_person_who_is_on_none_of_the_owners_farms_sees_nothing_of_a_team_schedule()
    {
        // a followed row can reach him without the listing showing it; the viewer rule still keeps its picture from him
        var (root, _) = OwnChain();
        Put(PictureKind.Schedule, root.Id, Owner, 1);
        Put(PictureKind.Person, Owner, Owner, 2);
        _repo.OverrideFarmsOf(Stranger, StrangerFarm);

        var result = await PullAs(Stranger, [PictureTestKit.Seat(StrangerFarm, false)], Dto(root));

        AssertShowsNothing(result[0]);
    }

    [Fact]
    public async Task An_outside_schedule_shows_its_institution_logo_to_everyone_and_never_a_person()
    {
        var outside = PictureTestKit.PublicSchedule(Guid.NewGuid());
        _repo.Templates[outside.Id] = outside;
        var logo = Put(PictureKind.Institution, outside.Id, Guid.NewGuid(), 4);
        // a stray schedule picture or person picture with the same subject must not show on an outside schedule
        Put(PictureKind.Schedule, outside.Id, Owner, 5);
        Put(PictureKind.Person, outside.Id, Owner, 6);

        var asStranger = await PullAs(Stranger, [PictureTestKit.Seat(StrangerFarm, false)], Dto(outside));
        var asWorker = await PullAs(Worker, [PictureTestKit.Seat(OwnerFarm, true)], Dto(outside));

        AssertShows(asStranger[0], logo);
        AssertShows(asWorker[0], logo);
    }

    [Fact]
    public async Task An_outside_schedule_with_no_logo_shows_nothing()
    {
        var outside = PictureTestKit.PublicSchedule(Guid.NewGuid());

        var result = await PullAs(Stranger, [], Dto(outside));

        AssertShowsNothing(result[0]);
    }

    [Fact]
    public async Task A_built_in_sample_with_no_scope_shows_nothing_and_does_not_throw()
    {
        var sample = new ScheduleTemplateDto(Guid.NewGuid(), "Sample", "Grapes", 100, [], [], "h");

        var result = await PullAs(Owner, [], sample);

        AssertShowsNothing(result[0]);
    }

    [Fact]
    public async Task A_version_whose_earlier_versions_are_not_in_the_listing_still_finds_its_root()
    {
        var (root, latest) = OwnChain();
        var picture = Put(PictureKind.Schedule, root.Id, Owner, 1);

        // only the newest version is listed (a followed row): the root is read once by id
        var result = await PullAs(Owner, [], Dto(latest));

        AssertShows(result[0], picture);
    }

    [Fact]
    public async Task Every_other_field_of_the_dto_is_returned_untouched_and_a_schedule_with_no_picture_is_the_same_instance()
    {
        var (root, _) = OwnChain();
        var dto = Dto(root) with { RowVersionTag = "v1", Variety = "Thompson" };

        var untouched = await PullAs(Owner, [], dto);
        untouched[0].Should().BeSameAs(dto);

        var face = Put(PictureKind.Person, Owner, Owner, 2);
        var shown = await PullAs(Owner, [], dto);
        shown[0].Should().BeEquivalentTo(dto with { PictureId = face.Id, PictureSha256 = face.Sha256, PictureKind = "PERSON" });
    }

    [Fact]
    public async Task The_three_picture_fields_are_the_last_three_optional_parameters_of_the_dto()
    {
        // P11: append only, never rename or remove - release 1.0.17 reads named fields only and ignores the rest
        var parameters = typeof(ScheduleTemplateDto).GetConstructors().Single().GetParameters();
        var last = parameters.TakeLast(3).Select(p => p.Name).ToArray();

        last.Should().Equal("PictureId", "PictureSha256", "PictureKind");
        parameters.TakeLast(3).Should().OnlyContain(p => p.IsOptional);
        parameters.Select(p => p.Name).Should().Contain(["Id", "OwnerUserId", "MadeByUserId", "MadeAtUtc", "PreviousVersionId", "DraftStages"]);
    }

    [Fact]
    public async Task A_picture_set_for_one_person_never_shows_on_another_persons_schedule()
    {
        var (root, _) = OwnChain();
        Put(PictureKind.Person, Stranger, Stranger, 7);

        var result = await PullAs(Owner, [], Dto(root));

        AssertShowsNothing(result[0]);
    }
}
