// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146; P6, E4)
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Pictures;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Pictures;
using Xunit;

namespace ShramSafal.Domain.Tests.Pictures;

/// <summary>
/// The file door: the database lets every user scope READ a picture row, so this is the wall. A made-up id, a face the caller may not see and a
/// schedule he may not see all answer the same NotFound (E4).
/// </summary>
public sealed class GetPictureFileHandlerTests
{
    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly Guid CoOwner = Guid.NewGuid();
    private static readonly Guid Worker = Guid.NewGuid();
    private static readonly Guid Stranger = Guid.NewGuid();
    private static readonly Guid OwnerFarm = Guid.NewGuid();

    private readonly PictureRepo _repo = new();
    private readonly MemoryPictureStore _store = new();
    private readonly MemoryStorage _storage = new();

    public GetPictureFileHandlerTests()
    {
        _repo.Farms[OwnerFarm] = PictureTestKit.FarmOwnedBy(OwnerFarm, Owner);
        _repo.Seat(OwnerFarm, CoOwner, AppRole.SecondaryOwner);
        _repo.Seat(OwnerFarm, Worker, AppRole.Worker);
    }

    private GetPictureFileHandler Handler() => new(_repo, _store, _storage, new FixedClock(PictureTestKit.Now));

    private Picture Store(PictureKind kind, Guid subject, Guid setBy, byte fill = 1)
    {
        var bytes = PictureTestKit.Jpeg(80, fill);
        var picture = Picture.Create(
            Guid.NewGuid(), kind, subject, PictureRules.Jpeg, bytes.Length, PictureRules.Sha256Hex(bytes),
            new AgriSync.SharedKernel.Contracts.Ids.UserId(setBy), PictureTestKit.Now);
        _store.Rows.Add(picture);
        _storage.Files[picture.StorageKey] = bytes;
        return picture;
    }

    private Guid OwnChain()
    {
        var root = PictureTestKit.OwnSchedule(Guid.NewGuid(), Owner);
        _repo.Templates[root.Id] = root;
        return root.Id;
    }

    [Fact]
    public async Task A_person_reads_his_own_picture_with_its_type_and_hash()
    {
        var face = Store(PictureKind.Person, Owner, Owner);

        var result = await Handler().HandleAsync(new GetPictureFileQuery(face.Id, Owner));

        result.IsSuccess.Should().BeTrue();
        result.Value!.ContentType.Should().Be("image/jpeg");
        result.Value.Sha256.Should().Be(face.Sha256);
        using var copy = new MemoryStream();
        await result.Value.ContentStream.CopyToAsync(copy);
        copy.ToArray().Should().Equal(_storage.Files[face.StorageKey]);
    }

    [Fact]
    public async Task A_seat_that_reads_the_owners_farm_sees_his_face_and_a_worker_on_an_own_records_seat_does_not()
    {
        var face = Store(PictureKind.Person, Owner, Owner);

        (await Handler().HandleAsync(new GetPictureFileQuery(face.Id, CoOwner))).IsSuccess.Should().BeTrue();

        var worker = await Handler().HandleAsync(new GetPictureFileQuery(face.Id, Worker));
        worker.IsSuccess.Should().BeFalse();
        worker.Error.Should().Be(ShramSafalErrors.PictureNotFound);
    }

    [Fact]
    public async Task A_stranger_never_sees_a_face_and_gets_the_same_answer_as_for_a_made_up_id()
    {
        var face = Store(PictureKind.Person, Owner, Owner);

        var real = await Handler().HandleAsync(new GetPictureFileQuery(face.Id, Stranger));
        var fake = await Handler().HandleAsync(new GetPictureFileQuery(Guid.NewGuid(), Stranger));

        real.Error.Should().Be(ShramSafalErrors.PictureNotFound);
        fake.Error.Should().Be(ShramSafalErrors.PictureNotFound);
    }

    [Fact]
    public async Task A_schedule_picture_is_seen_by_the_team_an_own_records_seat_included_and_not_by_a_stranger()
    {
        var picture = Store(PictureKind.Schedule, OwnChain(), Owner);

        (await Handler().HandleAsync(new GetPictureFileQuery(picture.Id, Owner))).IsSuccess.Should().BeTrue();
        (await Handler().HandleAsync(new GetPictureFileQuery(picture.Id, CoOwner))).IsSuccess.Should().BeTrue();
        (await Handler().HandleAsync(new GetPictureFileQuery(picture.Id, Worker))).IsSuccess.Should().BeTrue("a logo is not a face");
        (await Handler().HandleAsync(new GetPictureFileQuery(picture.Id, Stranger))).Error.Should().Be(ShramSafalErrors.PictureNotFound);
    }

    [Fact]
    public async Task An_institution_logo_is_seen_by_everyone_but_only_while_its_schedule_is_outside()
    {
        var outside = PictureTestKit.PublicSchedule(Guid.NewGuid());
        _repo.Templates[outside.Id] = outside;
        var logo = Store(PictureKind.Institution, outside.Id, Guid.NewGuid());

        (await Handler().HandleAsync(new GetPictureFileQuery(logo.Id, Stranger))).IsSuccess.Should().BeTrue();
        (await Handler().HandleAsync(new GetPictureFileQuery(logo.Id, Worker))).IsSuccess.Should().BeTrue();

        // a logo row whose subject is an own (Team) schedule - never set by the door, but if it were there it would not be served
        var strayLogo = Store(PictureKind.Institution, OwnChain(), Guid.NewGuid(), 2);
        (await Handler().HandleAsync(new GetPictureFileQuery(strayLogo.Id, Stranger))).Error.Should().Be(ShramSafalErrors.PictureNotFound);
    }

    [Fact]
    public async Task A_row_whose_file_is_missing_answers_not_found_never_a_broken_stream()
    {
        var face = Store(PictureKind.Person, Owner, Owner);
        _storage.Files.Remove(face.StorageKey);

        var result = await Handler().HandleAsync(new GetPictureFileQuery(face.Id, Owner));

        result.Error.Should().Be(ShramSafalErrors.PictureNotFound);
    }

    [Fact]
    public async Task An_empty_id_or_caller_is_not_found()
    {
        (await Handler().HandleAsync(new GetPictureFileQuery(Guid.Empty, Owner))).Error.Should().Be(ShramSafalErrors.PictureNotFound);
        (await Handler().HandleAsync(new GetPictureFileQuery(Guid.NewGuid(), Guid.Empty))).Error.Should().Be(ShramSafalErrors.PictureNotFound);
    }
}
