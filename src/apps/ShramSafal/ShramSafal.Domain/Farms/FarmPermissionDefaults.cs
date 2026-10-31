using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2), lane 2b — the ONE rule that turns (label, stored
/// choice) into the stored-bit set. Founder D-22 / D-26: the PRIMARY account holder holds every
/// authority; every other label — सहमालक and कुटुंब included — holds exactly what the primary
/// account holder stored for that person, and nothing by itself.
/// <list type="bullet">
/// <item><b>PrimaryOwner</b> — every grantable bit, always. A stored value is ignored.</item>
/// <item><b>Every other role</b> — the stored choice (<c>null</c> = nothing). Lane 2b's migration
/// wrote each existing seat's powers as an explicit choice, so <c>null</c> now means "nothing" for
/// every label (P11 is kept by the migration, not by a role default).</item>
/// </list>
/// Expiry and the "requires see money" rule are applied by <see cref="FarmMembership.Holds"/> and
/// the application's access policy, with a clock; this type is clock-free. The retired
/// <see cref="FarmPermission.Invite"/> bit is never part of any answer.
/// </summary>
public static class FarmPermissionDefaults
{
    /// <summary>Every GRANTABLE bit this release knows (the retired Invite and AddCost bits excluded).</summary>
    public const FarmPermission All =
        FarmPermission.SeeMoney
        | FarmPermission.SeeWages
        | FarmPermission.ReviewMoney
        | FarmPermission.PlanWork
        | FarmPermission.AddTestRecord
        | FarmPermission.AssignWork
        | FarmPermission.ConfirmRecords
        | FarmPermission.EditFarmSetup
        | FarmPermission.ManageScheduleTemplates;

    /// <summary>Every bit a stored value may legally carry (a pre-2b row may still hold a retired bit).</summary>
    public const FarmPermission Known = All | FarmPermission.Invite | FarmPermission.AddCost;

    /// <summary>What a label holds when the owner stored nothing: the primary owner everything, everyone else nothing.</summary>
    public static FarmPermission For(AppRole role) => role switch
    {
        AppRole.PrimaryOwner => All,
        _ => FarmPermission.None,
    };

    /// <summary>
    /// The stored-bit set for a label and the owner's stored choice: <see cref="All"/> for the
    /// primary owner, the stored choice (minus unknown and retired bits) for everyone else.
    /// </summary>
    public static FarmPermission Effective(AppRole role, FarmPermission? stored) =>
        role == AppRole.PrimaryOwner
            ? All
            : (stored ?? For(role)) & All;

    /// <summary><c>true</c> when <paramref name="value"/> uses only bits a stored value may carry.</summary>
    public static bool IsKnown(FarmPermission value) => (value & ~Known) == 0;

    /// <summary>The flag NAMES (never the ordinals) in a stable order, for the wire. A retired bit (Invite, AddCost) is never named.</summary>
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
    /// or is a retired one (<c>Invite</c>, <c>AddCost</c>), which can never be granted — so the caller
    /// refuses the whole request rather than store a set the owner did not choose.
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
        FarmPermission.ReviewMoney,
        FarmPermission.PlanWork,
        FarmPermission.AddTestRecord,
        FarmPermission.AssignWork,
        FarmPermission.ConfirmRecords,
        FarmPermission.EditFarmSetup,
        FarmPermission.ManageScheduleTemplates,
    ];
}
