using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: plr-d10 lane MU-2 (MU design §2 "Label"; founder D-22, D-26; register F79) — who a person is on this farm, in
/// the owner's own words. A label is human context and <b>grants nothing</b>: every authority is stored one by one
/// (<see cref="FarmAuthority"/>). The enum NAME is the wire name and the stored text (<c>relationship_label</c>).
///
/// <para><b>Why it exists apart from the role.</b> सहमालक and कुटुंब are both stored as
/// <see cref="AppRole.SecondaryOwner"/>, so the server could not tell them apart (F79). An invitation now carries the
/// label the owner chose and the seat keeps it. Seats made before lane MU-2 carry none (<c>null</c>) and keep reading
/// their role — no label is ever guessed for them (D-8, P4).</para>
/// <para>मालक (the primary account holder) is not here: ownership is never handed out by an invitation.</para>
/// </summary>
public enum RelationshipLabel
{
    /// <summary>सहमालक.</summary>
    CoOwner,

    /// <summary>कुटुंब.</summary>
    Family,

    /// <summary>मुकादम / जबाबदार.</summary>
    Mukadam,

    /// <summary>कामगार.</summary>
    Worker,
}

/// <summary>lane MU-2 — the pure rules of <see cref="RelationshipLabel"/>.</summary>
public static class RelationshipLabels
{
    /// <summary>The seat role a label is stored under (the label itself is kept beside it).</summary>
    public static AppRole RoleOf(RelationshipLabel label) => label switch
    {
        RelationshipLabel.CoOwner => AppRole.SecondaryOwner,
        RelationshipLabel.Family => AppRole.SecondaryOwner,
        RelationshipLabel.Mukadam => AppRole.Mukadam,
        RelationshipLabel.Worker => AppRole.Worker,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "Unknown label."),
    };

    /// <summary>The label for a wire name (case-insensitive), or <c>null</c> for anything else — PrimaryOwner included.</summary>
    public static RelationshipLabel? Parse(string? name) =>
        !string.IsNullOrWhiteSpace(name)
        && Enum.TryParse<RelationshipLabel>(name.Trim(), ignoreCase: true, out var label)
        && Enum.IsDefined(label)
        && !int.TryParse(name.Trim(), out _)
            ? label
            : null;
}
