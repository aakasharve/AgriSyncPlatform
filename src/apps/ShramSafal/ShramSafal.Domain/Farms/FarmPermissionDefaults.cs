using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — what each role may do when the owner has not
/// said otherwise, and the ONE rule that turns (role, stored choice) into the effective set.
/// Founder D-22 (answered 26 Oct 2026): the PRIMARY owner holds the authority; a co-owner, family
/// or मुकादम label must not silently grant powers, and a preset is only a starting point.
/// <list type="bullet">
/// <item><b>PrimaryOwner</b> — everything, always. A stored value is ignored: nobody can switch
/// the primary owner's powers off.</item>
/// <item><b>Every other role</b>, SecondaryOwner included — nothing by default. A power exists
/// only when the primary owner stored it for that person (no phone switch draws one in step 2;
/// visible co-owner / family switches come with step 2b).</item>
/// </list>
/// The हजेरी व पक्कं switch is the separate labour grant, not a flag here. <c>null</c> stays "the
/// role's defaults" (P11), and after D-22 that can no longer mean money for anyone but the primary
/// owner. Pure: no I/O, no clock, so the domain suite enumerates every role.
/// </summary>
public static class FarmPermissionDefaults
{
    /// <summary>Every flag this release knows.</summary>
    public const FarmPermission All =
        FarmPermission.SeeMoney
        | FarmPermission.SeeWages
        | FarmPermission.AddCost
        | FarmPermission.PlanWork
        | FarmPermission.Invite
        | FarmPermission.AddTestRecord;

    /// <summary>The role's defaults (stored value <c>null</c>).</summary>
    public static FarmPermission For(AppRole role) => role switch
    {
        AppRole.PrimaryOwner => All,
        _ => FarmPermission.None,
    };

    /// <summary>
    /// The effective set for a role and the owner's stored choice. PrimaryOwner is always
    /// <see cref="All"/>; for every other role the stored value wins when present, otherwise the
    /// role's defaults. Unknown bits are dropped.
    /// </summary>
    public static FarmPermission Effective(AppRole role, FarmPermission? stored) =>
        role == AppRole.PrimaryOwner
            ? All
            : (stored ?? For(role)) & All;

    /// <summary><c>true</c> when <paramref name="value"/> uses only known bits.</summary>
    public static bool IsKnown(FarmPermission value) => (value & ~All) == 0;

    /// <summary>The flag NAMES (never the ordinals) in a stable order, for the wire.</summary>
    public static IReadOnlyList<string> Names(FarmPermission value)
    {
        var names = new List<string>();
        foreach (var flag in Ordered)
        {
            if ((value & flag) == flag)
            {
                names.Add(flag.ToString());
            }
        }

        return names;
    }

    /// <summary>
    /// Parses flag names from the wire (case-insensitive). <c>false</c> when any name is unknown —
    /// the caller refuses the whole request rather than store a partial set the owner did not
    /// choose.
    /// </summary>
    public static bool TryParse(IEnumerable<string>? names, out FarmPermission value)
    {
        value = FarmPermission.None;
        if (names is null)
        {
            return true;
        }

        foreach (var raw in names)
        {
            var name = raw?.Trim();
            var match = Ordered.FirstOrDefault(f => string.Equals(f.ToString(), name, StringComparison.OrdinalIgnoreCase));
            if (match == FarmPermission.None)
            {
                return false;
            }

            value |= match;
        }

        return true;
    }

    private static readonly FarmPermission[] Ordered =
    [
        FarmPermission.SeeMoney,
        FarmPermission.SeeWages,
        FarmPermission.AddCost,
        FarmPermission.PlanWork,
        FarmPermission.Invite,
        FarmPermission.AddTestRecord,
    ];
}
