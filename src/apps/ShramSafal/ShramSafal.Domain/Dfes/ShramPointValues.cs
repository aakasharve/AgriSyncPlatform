namespace ShramSafal.Domain.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Phase 0). Shram-point reward values.
/// Pure Domain record — zero dependencies. Consumed by Phase 2 reward stamping
/// (DailyRichnessDerivationService). Never re-declare these numbers elsewhere;
/// read them from <see cref="DfesTuning.Points"/>.
/// </summary>
public sealed record ShramPointValues(
    int NoWork,
    int Basic,
    int Rich,
    int ObservationBonus,
    int LearningBonus,
    int FollowupBonus)
{
    public static ShramPointValues Default { get; } =
        new(NoWork: 2, Basic: 5, Rich: 10, ObservationBonus: 3, LearningBonus: 5, FollowupBonus: 2);
}
