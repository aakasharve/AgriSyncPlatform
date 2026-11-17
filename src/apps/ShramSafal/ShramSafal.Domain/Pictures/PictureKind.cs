// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146)
namespace ShramSafal.Domain.Pictures;

/// <summary>
/// Whose picture a <see cref="Picture"/> is. On the wire and in the database it is the upper-case word
/// (<see cref="PictureKinds.ToWire"/>): the phone and the pull read those exact words.
/// </summary>
public enum PictureKind
{
    /// <summary>A person's own face or chosen image. Subject = that person's user id. Only he sets it.</summary>
    Person = 0,

    /// <summary>The picture of ONE schedule (every version of it). Subject = the root template id of its edit chain.</summary>
    Schedule = 1,

    /// <summary>The logo of the institution behind an outside (Public) schedule. Subject = that schedule's root template id.</summary>
    Institution = 2,
}

/// <summary>The wire words of <see cref="PictureKind"/>.</summary>
public static class PictureKinds
{
    public const string Person = "PERSON";
    public const string Schedule = "SCHEDULE";
    public const string Institution = "INSTITUTION";

    public static string ToWire(PictureKind kind) => kind switch
    {
        PictureKind.Person => Person,
        PictureKind.Schedule => Schedule,
        PictureKind.Institution => Institution,
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown picture kind."),
    };

    /// <summary>The kind a wire word names, or <c>false</c> for anything else (case-exact: the words are ours).</summary>
    public static bool TryParse(string? wire, out PictureKind kind)
    {
        switch (wire)
        {
            case Person: kind = PictureKind.Person; return true;
            case Schedule: kind = PictureKind.Schedule; return true;
            case Institution: kind = PictureKind.Institution; return true;
            default: kind = default; return false;
        }
    }
}
