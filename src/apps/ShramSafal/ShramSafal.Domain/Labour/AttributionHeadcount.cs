using ShramSafal.Domain.Farms;

namespace ShramSafal.Domain.Labour;

/// <summary>
/// spec: plr-d10 I26 (founder D-34, PLR-D10 L3b) — the ONE rule for how many
/// people may be NAMED on a work entry.
/// </summary>
/// <remarks>
/// <para>
/// <b>Voice Log tells HOW MANY for each work; attribution tells WHO in WHICH
/// work; neither overwrites the other.</b> A work that states 6 people may carry
/// up to 6 names; fewer leaves the rest anonymous ("३ जणांची नावं · ३ अनामिक").
/// A seventh name would contradict the count, and the count is NEVER raised to
/// fit the names (doctrine P7) — so the seventh name is refused instead.
/// </para>
/// <para>
/// This reads the count; it never writes it. A work with no stated count
/// (nobody said how many) has no limit to enforce: unknown is not zero (P4).
/// </para>
/// </remarks>
public static class AttributionHeadcount
{
    /// <summary>
    /// The work's stated headcount through the same canonical rule every reader
    /// uses (<see cref="LabourHeadcount.Resolve"/>); <c>null</c> when none was stated.
    /// </summary>
    public static int? StatedHeadcount(LabourAssignment assignment) =>
        LabourHeadcount.Resolve(assignment.WorkerCount, assignment.MaleCount, assignment.FemaleCount);

    /// <summary>
    /// True when <paramref name="namedAfter"/> distinct people would be named on a
    /// work that states <paramref name="statedHeadcount"/> people — i.e. more
    /// names than people. Always false when no headcount was stated.
    /// </summary>
    public static bool Exceeds(int? statedHeadcount, int namedAfter) =>
        statedHeadcount is { } headcount && namedAfter > headcount;
}
