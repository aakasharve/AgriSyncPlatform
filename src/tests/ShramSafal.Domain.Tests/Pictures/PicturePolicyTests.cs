// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146; P6)
using FluentAssertions;
using ShramSafal.Domain.Pictures;
using Xunit;

namespace ShramSafal.Domain.Tests.Pictures;

/// <summary>Which picture shows (schedule, then owner's person picture, then none; an outside schedule shows its logo) and who may set which kind.</summary>
public sealed class PicturePolicyTests
{
    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly Guid Other = Guid.NewGuid();
    private static readonly Guid Root = Guid.NewGuid();

    private static readonly Picture Schedule = PictureTestKit.PictureOf(PictureKind.Schedule, Root, Owner, 1);
    private static readonly Picture Person = PictureTestKit.PictureOf(PictureKind.Person, Owner, Owner, 2);
    private static readonly Picture Logo = PictureTestKit.PictureOf(PictureKind.Institution, Root, Other, 3);

    [Fact]
    public void An_own_schedule_shows_its_own_picture_before_the_owners_face()
    {
        PicturePolicy.Choose(false, Schedule, null, Person, viewerMayShowPerson: true).Should().BeSameAs(Schedule);
    }

    [Fact]
    public void Without_a_schedule_picture_the_owners_face_shows_when_the_viewer_may_see_it()
    {
        PicturePolicy.Choose(false, null, null, Person, viewerMayShowPerson: true).Should().BeSameAs(Person);
    }

    [Fact]
    public void A_viewer_who_may_not_see_the_face_gets_none_not_the_face()
    {
        PicturePolicy.Choose(false, null, null, Person, viewerMayShowPerson: false).Should().BeNull();
    }

    [Fact]
    public void A_logo_chosen_for_the_schedule_shows_even_to_a_viewer_who_may_not_see_faces()
    {
        PicturePolicy.Choose(false, Schedule, null, Person, viewerMayShowPerson: false).Should().BeSameAs(Schedule);
    }

    [Fact]
    public void Nothing_set_means_none_and_the_phone_draws_the_letter()
    {
        PicturePolicy.Choose(false, null, null, null, viewerMayShowPerson: true).Should().BeNull();
    }

    [Fact]
    public void An_outside_schedule_shows_its_institution_logo_or_none_never_a_person()
    {
        PicturePolicy.Choose(true, Schedule, Logo, Person, viewerMayShowPerson: true).Should().BeSameAs(Logo);
        PicturePolicy.Choose(true, Schedule, null, Person, viewerMayShowPerson: true).Should().BeNull();
    }

    [Fact]
    public void Only_he_sets_his_own_picture()
    {
        PicturePolicy.MaySetPerson(Owner, Owner).Should().BeTrue();
        PicturePolicy.MaySetPerson(Other, Owner).Should().BeFalse("nobody sets another person's picture (P6)");
        PicturePolicy.MaySetPerson(Guid.Empty, Guid.Empty).Should().BeFalse();
    }

    [Fact]
    public void Only_the_owner_person_sets_the_picture_of_his_own_schedule()
    {
        PicturePolicy.MaySetSchedule(Owner, Owner, chainIsPublic: false).Should().BeTrue();
        // a co-owner, a mukadam or a worker who typed a version is not the owner (the typist is not the person the picture is of)
        PicturePolicy.MaySetSchedule(Other, Owner, chainIsPublic: false).Should().BeFalse();
        PicturePolicy.MaySetSchedule(Owner, null, chainIsPublic: false).Should().BeFalse();
        PicturePolicy.MaySetSchedule(Guid.Empty, Guid.Empty, chainIsPublic: false).Should().BeFalse();
    }

    [Fact]
    public void An_outside_schedule_takes_no_schedule_picture_from_anyone()
    {
        PicturePolicy.MaySetSchedule(Owner, Owner, chainIsPublic: true).Should().BeFalse();
    }

    [Fact]
    public void A_persons_own_data_is_his_face_and_the_schedule_pictures_he_set_never_anyone_elses_or_a_logo()
    {
        var mine = PictureTestKit.PictureOf(PictureKind.Person, Owner, Owner, 1);
        var mySchedule = PictureTestKit.PictureOf(PictureKind.Schedule, Root, Owner, 2);
        var theirFace = PictureTestKit.PictureOf(PictureKind.Person, Other, Other, 3);
        var theirSchedule = PictureTestKit.PictureOf(PictureKind.Schedule, Guid.NewGuid(), Other, 4);
        // staff set the logo; even if the staff member is the person being exported or erased, a logo is not his personal data
        var logoSetByHim = PictureTestKit.PictureOf(PictureKind.Institution, Guid.NewGuid(), Owner, 5);
        var all = new[] { mine, mySchedule, theirFace, theirSchedule, logoSetByHim };

        var owned = all.Where(PicturePolicy.OwnedBy(Owner).Compile()).ToList();

        owned.Should().BeEquivalentTo([mine, mySchedule]);
        all.Where(PicturePolicy.OwnedBy(Guid.NewGuid()).Compile()).Should().BeEmpty();
    }

    [Fact]
    public void Only_staff_who_review_schedules_set_a_logo_and_only_on_an_outside_schedule()
    {
        PicturePolicy.MaySetInstitution(callerMayReviewSchedules: true, chainIsPublic: true).Should().BeTrue();
        PicturePolicy.MaySetInstitution(callerMayReviewSchedules: false, chainIsPublic: true).Should().BeFalse();
        PicturePolicy.MaySetInstitution(callerMayReviewSchedules: true, chainIsPublic: false).Should().BeFalse();
    }
}
