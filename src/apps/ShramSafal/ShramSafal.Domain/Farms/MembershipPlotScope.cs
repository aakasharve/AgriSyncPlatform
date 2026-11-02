namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: plr-d10 lane MU-4 (MU design §2 "Scope", §3 G2, §11.6, §11.7) — WHICH PLOTS one person's place on one farm
/// covers. The second of the three layers: the label grants nothing, the scope says which plots, the authorities say what
/// he may see or do there. Persisted as the literal member name in <c>ssf.farm_memberships.plot_scope</c>
/// (<c>ck_farm_memberships_plot_scope</c> compares against these exact strings), so renaming a member is a schema change.
/// </summary>
public enum MembershipPlotScope
{
    /// <summary>सर्व प्लॉट — every plot of the farm. The default: every seat made before MU-4 reads exactly what it read.</summary>
    AllPlots,

    /// <summary>निवडलेले प्लॉट — one or more chosen plots of THIS farm (<see cref="FarmMembership.ScopePlotIds"/>).</summary>
    ChosenPlots,

    /// <summary>
    /// स्वतःचं काम — his own work only: the farm's crop and plot NAMES (so crop → plot → speak works on any plot), his own
    /// records and the work assigned to him; nothing of other people's records or money (§11.7). The same read rule as the
    /// कामगार label (a label narrows, never widens: a seat is own-work when it has either).
    /// </summary>
    OwnWork,
}
