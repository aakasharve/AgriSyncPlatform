namespace ShramSafal.Domain.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Phase 0). Streak-fold rules. Pure Domain
/// record — zero dependencies. Consumed by the Phase-3 engagement fold
/// (streak advances on AdvancesStreak; UnaccountedDay is neutral within
/// GraceDaysBeforeBreak; a declared no-work day and a rest day do not break).
/// </summary>
public sealed record StreakRules(
    bool AdvanceOnDeclaredNoWork,
    bool NeutralOnRestDay,
    int GraceDaysBeforeBreak)
{
    public static StreakRules Default { get; } =
        new(AdvanceOnDeclaredNoWork: true, NeutralOnRestDay: true, GraceDaysBeforeBreak: 1);
}
