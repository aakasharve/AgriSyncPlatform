namespace ShramSafal.Domain.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Phase 0). Shram-point reward values.
/// Pure Domain record — zero dependencies. Consumed by Phase 2 reward stamping
/// (DailyRichnessDerivationService). Never re-declare these numbers elsewhere;
/// read them from <see cref="DfesTuning.Points"/>.
///
/// <para>spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3; founder D-94) - the three product-identity reasons.
/// They are added to the day's points and the daily cap (<see cref="DfesTuning.DailyPointCap"/>) still applies to the
/// total. <see cref="ProductConfirmed"/>: a "yes" (हो) about a product that the library FOUND (a yes on an unknown or
/// ambiguous name earns nothing). <see cref="EvidenceMatch"/>: a packet photo kept for a product the library found (a
/// bill match joins it when bills carry product names). <see cref="GapFilledLater"/>: the same yes or photo given on a
/// LATER day than the record's work day; it earns on the day it is given, and the work day's points never change.</para>
/// </summary>
public sealed record ShramPointValues(
    int NoWork,
    int Basic,
    int Rich,
    int ObservationBonus,
    int LearningBonus,
    int FollowupBonus,
    int ProductConfirmed,
    int EvidenceMatch,
    int GapFilledLater)
{
    public static ShramPointValues Default { get; } =
        new(NoWork: 2, Basic: 5, Rich: 10, ObservationBonus: 3, LearningBonus: 5, FollowupBonus: 2,
            ProductConfirmed: 2, EvidenceMatch: 3, GapFilledLater: 2);
}
