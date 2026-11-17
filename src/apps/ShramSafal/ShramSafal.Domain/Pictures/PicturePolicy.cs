// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146; P6, P11)
namespace ShramSafal.Domain.Pictures;

/// <summary>
/// WHICH picture a schedule shows and WHO may set which kind. Pure functions over facts the application has already read, so the rule
/// is proven by unit tests and the handlers only gather the facts.
/// </summary>
public static class PicturePolicy
{
    /// <summary>
    /// The picture a schedule shows to ONE viewer (spec A, "which picture shows"):
    /// <list type="bullet">
    /// <item>an outside (Public) schedule: the institution logo, else none;</item>
    /// <item>any other schedule: the schedule's own picture, else the owner's PERSON picture when the viewer may see it
    /// (<paramref name="viewerMayShowPerson"/>: he is the owner, or works on a farm of the owner with a seat that reads other
    /// people's records - the same rule that gives a seat other people's NAMES), else none.</item>
    /// </list>
    /// <c>null</c> = no picture: the phone draws its letter badge.
    /// </summary>
    public static Picture? Choose(
        bool scheduleIsPublic,
        Picture? schedulePicture,
        Picture? institutionPicture,
        Picture? ownerPersonPicture,
        bool viewerMayShowPerson)
    {
        if (scheduleIsPublic)
        {
            return institutionPicture;
        }

        if (schedulePicture is not null)
        {
            return schedulePicture;
        }

        return viewerMayShowPerson ? ownerPersonPicture : null;
    }

    /// <summary>A person's own picture: set only by him (nobody sets another person's, P6).</summary>
    public static bool MaySetPerson(Guid callerUserId, Guid subjectUserId) =>
        callerUserId != Guid.Empty && callerUserId == subjectUserId;

    /// <summary>
    /// The picture of ONE own schedule: set only by the PERSON the schedule belongs to (<paramref name="chainOwnerUserId"/>: the chain's
    /// owner, never the typist of a version), and never for an outside (Public) schedule. A co-owner, a mukadam or a worker who typed a
    /// version is not that person (P6: the typist is not the person the picture is of).
    /// </summary>
    public static bool MaySetSchedule(Guid callerUserId, Guid? chainOwnerUserId, bool chainIsPublic) =>
        !chainIsPublic && callerUserId != Guid.Empty && chainOwnerUserId is { } owner && owner == callerUserId;

    /// <summary>The logo of an outside (Public) schedule: set only by ShramSafal staff who may review schedules (<c>ModuleKey.ScheduleReview</c>).</summary>
    public static bool MaySetInstitution(bool callerMayReviewSchedules, bool chainIsPublic) =>
        callerMayReviewSchedules && chainIsPublic;

    /// <summary>
    /// The pictures that are HIS PERSONAL DATA, for the export (his file goes into his ZIP) and for erasure (his rows and files are deleted): his own PERSON
    /// picture, and the SCHEDULE pictures he set. Never another person's, and never an INSTITUTION logo (not a person's data; it stays when he is erased).
    /// The erasure worker states the same rule in SQL (<c>ErasureWorker.DeletePicturesOfUserAsync</c>); a real-Postgres test holds the two to one answer.
    /// </summary>
    public static System.Linq.Expressions.Expression<Func<Picture, bool>> OwnedBy(Guid userId)
    {
        var user = new AgriSync.SharedKernel.Contracts.Ids.UserId(userId);
        return p => (p.Kind == PictureKind.Person && p.SubjectId == userId)
            || (p.Kind == PictureKind.Schedule && p.SetByUserId == user);
    }
}
