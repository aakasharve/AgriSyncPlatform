// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146; P6, E4)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Pictures;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Pictures;
using Xunit;

namespace ShramSafal.Domain.Tests.Pictures;

/// <summary>Setting and removing: size and first-byte checks, who may set which kind, replace deletes the old file, nothing touches a version.</summary>
public sealed class SetAndRemovePictureHandlerTests
{
    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly Guid CoOwner = Guid.NewGuid();
    private static readonly Guid Staff = Guid.NewGuid();
    private static readonly Guid Stranger = Guid.NewGuid();

    private readonly PictureRepo _repo = new();
    private readonly MemoryPictureStore _store = new();
    private readonly MemoryStorage _storage = new();

    private SetPictureHandler Set() =>
        new(_repo, _store, _storage, new FixedClock(PictureTestKit.Now), NullLogger<SetPictureHandler>.Instance, new StaffEntitlements(Staff));

    private RemovePictureHandler Remove() =>
        new(_repo, _store, _storage, NullLogger<RemovePictureHandler>.Instance, new StaffEntitlements(Staff));

    private static SetPictureCommand Put(PictureKind kind, Guid? route, byte[] bytes, Guid caller) =>
        new(kind, route, new MemoryStream(bytes), caller, "1.0.17", "device-1", "sha256:ip");

    private static RemovePictureCommand Del(PictureKind kind, Guid? route, Guid caller) =>
        new(kind, route, caller, "1.0.17", "device-1", "sha256:ip");

    private Guid OwnChain(int versions = 1)
    {
        var root = PictureTestKit.OwnSchedule(Guid.NewGuid(), Owner);
        _repo.Templates[root.Id] = root;
        var last = root;
        for (var i = 1; i < versions; i++)
        {
            // a co-owner types the later versions: the picture must still hang on the root, which is the owner's
            var next = last.EditCopyOnWrite(Guid.NewGuid(), null, null, new UserId(CoOwner), PictureTestKit.Now);
            _repo.Templates[next.Id] = next;
            last = next;
        }

        return root.Id;
    }

    // ---- the file --------------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_person_sets_his_own_picture_the_row_the_file_and_the_audit_are_written()
    {
        var bytes = PictureTestKit.Jpeg(200);

        var result = await Set().HandleAsync(Put(PictureKind.Person, null, bytes, Owner));

        result.IsSuccess.Should().BeTrue();
        var row = _store.Rows.Should().ContainSingle().Subject;
        row.Kind.Should().Be(PictureKind.Person);
        row.SubjectId.Should().Be(Owner);
        row.SetByUserId.Value.Should().Be(Owner);
        row.Sha256.Should().Be(PictureRules.Sha256Hex(bytes));
        row.ContentType.Should().Be("image/jpeg");
        row.Bytes.Should().Be(200);
        _storage.Files.Should().ContainKey(row.StorageKey);
        _storage.Files[row.StorageKey].Should().Equal(bytes);
        result.Value!.Sha256.Should().Be(row.Sha256);

        var audit = _repo.Audits.Should().ContainSingle().Subject;
        audit.EntityType.Should().Be("Picture");
        audit.Action.Should().Be("PictureSet");
        audit.ActorUserId.Value.Should().Be(Owner);
        audit.Payload.Should().Contain(row.Sha256).And.Contain("PERSON");
        audit.Payload.Should().NotContain(Convert.ToBase64String(bytes), "the audit row never carries the image");
        _store.Saves.Should().Be(1, "the first picture of a subject saves through the store (it can tell a lost first-upload race)");
        _repo.Saves.Should().Be(0);
    }

    [Fact]
    public async Task The_type_is_the_first_bytes_not_the_name_so_svg_and_pdf_and_random_bytes_are_refused_and_nothing_is_written()
    {
        foreach (var refused in new[]
                 {
                     "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>"u8.ToArray(),
                     "%PDF-1.7 ..."u8.ToArray(),
                     "just some text pretending to be a photo.jpg"u8.ToArray(),
                 })
        {
            var result = await Set().HandleAsync(Put(PictureKind.Person, null, refused, Owner));

            result.IsSuccess.Should().BeFalse();
            result.Error.Should().Be(ShramSafalErrors.PictureUnsupportedType);
        }

        _store.Rows.Should().BeEmpty();
        _storage.Files.Should().BeEmpty();
        _repo.Audits.Should().BeEmpty();
        _repo.Saves.Should().Be(0);
    }

    [Fact]
    public async Task An_empty_file_is_refused()
    {
        var result = await Set().HandleAsync(Put(PictureKind.Person, null, [], Owner));

        result.Error.Should().Be(ShramSafalErrors.PictureEmpty);
        _store.Rows.Should().BeEmpty();
    }

    [Fact]
    public async Task Up_to_the_cap_is_kept_and_one_byte_over_is_refused_without_reading_a_row()
    {
        var atCap = await Set().HandleAsync(Put(PictureKind.Person, null, PictureTestKit.Webp(PictureRules.MaxBytes), Owner));
        atCap.IsSuccess.Should().BeTrue("a file between 256 KB and the 512 KB cap is kept as it is");

        var other = Guid.NewGuid();
        var tooBig = await Set().HandleAsync(Put(PictureKind.Person, null, PictureTestKit.Webp(PictureRules.MaxBytes + 1), other));

        tooBig.IsSuccess.Should().BeFalse();
        tooBig.Error.Should().Be(ShramSafalErrors.PictureTooLarge);
        _store.Rows.Should().ContainSingle("only the file at the cap was stored");
    }

    [Fact]
    public async Task The_same_file_again_changes_nothing_no_second_audit_row_and_no_delete()
    {
        var bytes = PictureTestKit.Png(100);
        await Set().HandleAsync(Put(PictureKind.Person, null, bytes, Owner));
        var key = _store.Rows.Single().StorageKey;
        var deletesBefore = _storage.Deleted.Count;

        var again = await Set().HandleAsync(Put(PictureKind.Person, null, bytes, Owner));

        again.IsSuccess.Should().BeTrue();
        _store.Rows.Should().ContainSingle();
        _repo.Audits.Should().ContainSingle();
        _storage.Deleted.Count.Should().Be(deletesBefore, "the same file again touches no storage");
        _storage.Files.Should().ContainKey(key);
    }

    [Fact]
    public async Task Replacing_updates_the_same_row_and_deletes_the_old_file()
    {
        var first = PictureTestKit.Jpeg(100, 1);
        var second = PictureTestKit.Png(120, 2);
        await Set().HandleAsync(Put(PictureKind.Person, null, first, Owner));
        var row = _store.Rows.Single();
        var id = row.Id;
        var oldKey = row.StorageKey;

        var result = await Set().HandleAsync(Put(PictureKind.Person, null, second, Owner));

        result.IsSuccess.Should().BeTrue();
        _store.Rows.Should().ContainSingle().Which.Id.Should().Be(id);
        row.Sha256.Should().Be(PictureRules.Sha256Hex(second));
        row.ContentType.Should().Be("image/png");
        _storage.Files.Should().NotContainKey(oldKey);
        _storage.Deleted.Should().Contain(oldKey);
        _storage.Files.Should().ContainKey(row.StorageKey);
        _repo.Audits.Should().HaveCount(2);
        _repo.Audits[1].Payload.Should().Contain("\"replaced\":true");
    }

    [Fact]
    public async Task A_failed_delete_of_the_old_file_does_not_undo_the_new_picture()
    {
        await Set().HandleAsync(Put(PictureKind.Person, null, PictureTestKit.Jpeg(100, 1), Owner));
        var oldKey = _store.Rows.Single().StorageKey;
        _storage.FailDeleteOf.Add(oldKey);

        var result = await Set().HandleAsync(Put(PictureKind.Person, null, PictureTestKit.Png(100, 2), Owner));

        // the row already names the new file; the old one is left unreferenced (and logged), never a row pointing at nothing
        result.IsSuccess.Should().BeTrue();
        var row = _store.Rows.Single();
        row.ContentType.Should().Be("image/png");
        _storage.Files.Should().ContainKey(row.StorageKey);
    }

    [Fact]
    public async Task A_storage_that_may_not_delete_can_still_set_a_picture()
    {
        // a deployment whose role has no delete permission: the clear-before-save is best effort, so setting still works
        var bytes = PictureTestKit.Jpeg(100, 1);
        _storage.FailDeleteOf.Add(PictureRules.StorageKeyFor(PictureKind.Person, Owner, PictureRules.Sha256Hex(bytes)));

        var result = await Set().HandleAsync(Put(PictureKind.Person, null, bytes, Owner));

        result.IsSuccess.Should().BeTrue();
        _store.Rows.Should().ContainSingle();
    }

    // ---- who may set which kind ----------------------------------------------------------------------------------------

    [Fact]
    public async Task The_owner_sets_the_picture_of_his_own_schedule_and_it_hangs_on_the_root_whichever_version_is_named()
    {
        var root = OwnChain(versions: 3);
        var latest = _repo.Templates.Values.Single(t => t.Version == 3).Id;

        var result = await Set().HandleAsync(Put(PictureKind.Schedule, latest, PictureTestKit.Webp(), Owner));

        result.IsSuccess.Should().BeTrue();
        var row = _store.Rows.Single();
        row.Kind.Should().Be(PictureKind.Schedule);
        row.SubjectId.Should().Be(root, "the picture hangs on the root of the chain, so every version shares it");
    }

    [Fact]
    public async Task A_co_owner_who_typed_a_version_cannot_set_the_owners_schedule_picture()
    {
        var root = OwnChain(versions: 2);
        // CoOwner works on the owner's farm (so he SEES the schedule), but he is not the person it belongs to
        var farm = Guid.NewGuid();
        _repo.Farms[farm] = PictureTestKit.FarmOwnedBy(farm, Owner);
        _repo.OverrideFarmsOf(CoOwner, farm);

        var result = await Set().HandleAsync(Put(PictureKind.Schedule, root, PictureTestKit.Jpeg(), CoOwner));

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be(ShramSafalErrors.PictureForbidden);
        _store.Rows.Should().BeEmpty();
        _storage.Files.Should().BeEmpty();
        _repo.Audits.Should().BeEmpty();
    }

    [Fact]
    public async Task A_stranger_gets_not_found_for_a_schedule_he_may_not_see_like_an_unknown_id()
    {
        var root = OwnChain();

        var known = await Set().HandleAsync(Put(PictureKind.Schedule, root, PictureTestKit.Jpeg(), Stranger));
        var unknown = await Set().HandleAsync(Put(PictureKind.Schedule, Guid.NewGuid(), PictureTestKit.Jpeg(), Stranger));

        known.Error.Should().Be(ShramSafalErrors.ScheduleTemplateNotFound);
        unknown.Error.Should().Be(ShramSafalErrors.ScheduleTemplateNotFound);
        _store.Rows.Should().BeEmpty();
    }

    [Fact]
    public async Task Nobody_sets_a_schedule_picture_on_an_outside_schedule_not_even_the_staff_who_imported_it()
    {
        var outside = PictureTestKit.PublicSchedule(Guid.NewGuid());
        _repo.Templates[outside.Id] = outside;

        var result = await Set().HandleAsync(Put(PictureKind.Schedule, outside.Id, PictureTestKit.Jpeg(), Staff));

        result.IsSuccess.Should().BeFalse();
        _store.Rows.Should().BeEmpty();
    }

    [Fact]
    public async Task Staff_set_the_logo_of_an_outside_schedule_and_a_farmer_cannot()
    {
        var outside = PictureTestKit.PublicSchedule(Guid.NewGuid());
        _repo.Templates[outside.Id] = outside;

        var farmer = await Set().HandleAsync(Put(PictureKind.Institution, outside.Id, PictureTestKit.Png(), Owner));
        farmer.Error.Should().Be(ShramSafalErrors.PictureForbidden);
        _store.Rows.Should().BeEmpty();

        var staff = await Set().HandleAsync(Put(PictureKind.Institution, outside.Id, PictureTestKit.Png(), Staff));
        staff.IsSuccess.Should().BeTrue();
        var row = _store.Rows.Single();
        row.Kind.Should().Be(PictureKind.Institution);
        row.SubjectId.Should().Be(outside.Id);
        _repo.Audits.Single().ActorRole.Should().Be("platform_staff");
    }

    [Fact]
    public async Task Staff_are_asked_before_anything_about_the_schedule_is_learned()
    {
        // a farmer asking for an own schedule's logo, and for a made-up id, gets the SAME answer: Forbidden, no hint
        var own = OwnChain();
        var real = await Set().HandleAsync(Put(PictureKind.Institution, own, PictureTestKit.Png(), Owner));
        var fake = await Set().HandleAsync(Put(PictureKind.Institution, Guid.NewGuid(), PictureTestKit.Png(), Owner));

        real.Error.Should().Be(ShramSafalErrors.PictureForbidden);
        fake.Error.Should().Be(ShramSafalErrors.PictureForbidden);
    }

    [Fact]
    public async Task Staff_cannot_hang_a_logo_on_a_private_or_team_schedule()
    {
        var own = OwnChain();

        var result = await Set().HandleAsync(Put(PictureKind.Institution, own, PictureTestKit.Png(), Staff));

        result.IsSuccess.Should().BeFalse();
        _store.Rows.Should().BeEmpty();
    }

    [Fact]
    public async Task Changing_a_picture_never_touches_a_version_row()
    {
        var root = OwnChain(versions: 2);
        var before = _repo.Templates.Values.Select(t => (t.Id, t.Version, t.CreatedAtUtc, Maker: t.CreatedByUserId, t.OwnerUserId, t.PreviousVersionId)).ToList();

        await Set().HandleAsync(Put(PictureKind.Schedule, root, PictureTestKit.Jpeg(100, 1), Owner));
        await Set().HandleAsync(Put(PictureKind.Schedule, root, PictureTestKit.Png(100, 2), Owner));
        await Remove().HandleAsync(Del(PictureKind.Schedule, root, Owner));

        var after = _repo.Templates.Values.Select(t => (t.Id, t.Version, t.CreatedAtUtc, Maker: t.CreatedByUserId, t.OwnerUserId, t.PreviousVersionId)).ToList();
        after.Should().Equal(before, "who typed each version and when stays exactly as it was");
        _repo.Templates.Count.Should().Be(2);
    }

    // ---- removing ---------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Removing_deletes_the_row_and_the_file_and_writes_the_audit_row()
    {
        await Set().HandleAsync(Put(PictureKind.Person, null, PictureTestKit.Jpeg(100), Owner));
        var key = _store.Rows.Single().StorageKey;

        var result = await Remove().HandleAsync(Del(PictureKind.Person, null, Owner));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeTrue();
        _store.Rows.Should().BeEmpty();
        _storage.Files.Should().NotContainKey(key);
        _repo.Audits.Last().Action.Should().Be("PictureRemoved");
        _repo.Audits.Last().Payload.Should().Contain(PictureRules.Sha256Hex(PictureTestKit.Jpeg(100)));
    }

    [Fact]
    public async Task Removing_what_is_not_there_succeeds_and_writes_nothing()
    {
        var result = await Remove().HandleAsync(Del(PictureKind.Person, null, Owner));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeFalse();
        _repo.Audits.Should().BeEmpty();
        _repo.Saves.Should().Be(0);
    }

    [Fact]
    public async Task A_co_owner_cannot_remove_the_owners_schedule_picture()
    {
        var root = OwnChain();
        await Set().HandleAsync(Put(PictureKind.Schedule, root, PictureTestKit.Jpeg(), Owner));
        var farm = Guid.NewGuid();
        _repo.Farms[farm] = PictureTestKit.FarmOwnedBy(farm, Owner);
        _repo.OverrideFarmsOf(CoOwner, farm);

        var result = await Remove().HandleAsync(Del(PictureKind.Schedule, root, CoOwner));

        result.IsSuccess.Should().BeFalse();
        _store.Rows.Should().ContainSingle();
    }

    [Fact]
    public async Task A_person_removes_only_his_own_picture_there_is_no_way_to_name_another()
    {
        await Set().HandleAsync(Put(PictureKind.Person, null, PictureTestKit.Jpeg(), Owner));

        // the Person route has no subject: Stranger's remove addresses Stranger's own (empty) picture, never Owner's
        var result = await Remove().HandleAsync(Del(PictureKind.Person, null, Stranger));

        result.Value.Should().BeFalse();
        _store.Rows.Should().ContainSingle().Which.SubjectId.Should().Be(Owner);
    }
}
