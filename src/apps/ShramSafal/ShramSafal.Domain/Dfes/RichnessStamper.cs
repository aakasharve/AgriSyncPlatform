namespace ShramSafal.Domain.Dfes;

/// <summary>Per-day reward + streak/bar flags. RewardReasonsJson is a compact,
/// human-auditable breakdown for the warm message (Phase 3).</summary>
public readonly record struct RewardStamp(
    int ShramPointsEarned, bool AdvancesStreak, bool AdvancesBar, string RewardReasonsJson);

/// <summary>Turns a DayClassification + signals into the day's reward economy.
/// EVERY number comes from DfesTuning.Points / DfesTuning.Streak / DfesTuning.DailyPointCap
/// (Phase 0, static) — nothing hardcoded. This is the ONLY place the reward is
/// computed per day; Phase 3 folds the flags across days.</summary>
public static class RichnessStamper
{
    private static readonly string[] RestReasons = ["rest", "festival", "personal"];

    /// <param name="dayHasConfirmedRecord">
    /// spec: dfes-input-truth-and-mix-check-2026-11-06 (item 7; founder D-46) — whether at least one of the day's
    /// records is confirmed (मंजूर), as the caller read it off the records (the Domain has no database). A day advances
    /// the streak only when it is: <c>false</c> takes the streak flag down and nothing else — the points, the bar and
    /// the reasons are exactly what they would be confirmed (points are not this rule's business). Required, never
    /// defaulted: a caller that has not looked must not imply a confirmation. Confirmation is a fact about the
    /// records, not a scoring rule, so it applies on every recompute whatever engine version froze the day.
    /// </param>
    /// <param name="identity">
    /// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3; founder D-94) — the product-answer points this day earned
    /// (see <see cref="ProductIdentityPoints"/>), worked out by the caller from the append-only answers. Required, never
    /// defaulted, for the reason the recompute reads the answers at the one point every path goes through: a path that
    /// forgot them would stamp lower points over the row. They are added to the day's points and the daily cap
    /// (<see cref="DfesTuning.DailyPointCap"/>) still applies to the total. They never touch the streak, the bar or the
    /// classification. A day whose date cannot be trusted (<see cref="DayClassification.PendingReconciliation"/>) earns
    /// nothing, as before.
    /// </param>
    public static RewardStamp Stamp(
        DayClassification classification, ClassifierSignals s, bool dayHasConfirmedRecord, IdentityPoints identity)
    {
        var stamp = StampDay(classification, s, classification == DayClassification.PendingReconciliation ? IdentityPoints.None : identity);
        return dayHasConfirmedRecord ? stamp : stamp with { AdvancesStreak = false };
    }

    private static RewardStamp StampDay(DayClassification classification, ClassifierSignals s, IdentityPoints identity)
    {
        var p = DfesTuning.Points;

        switch (classification)
        {
            case DayClassification.RichWorkDay:
                {
                    var points = p.Rich
                        + (s.HasStructuredObservation ? p.ObservationBonus : 0)
                        + (s.HasLearning ? p.LearningBonus : 0)
                        + (s.HasFollowup ? p.FollowupBonus : 0);
                    var capped = WithIdentity(Math.Min(points, DfesTuning.DailyPointCap), identity);
                    return new RewardStamp(capped, true, true,
                        Reasons("RichWorkDay", p.Rich, s, identity, capped));
                }

            case DayClassification.BasicWorkDay:
                return new RewardStamp(WithIdentity(p.Basic, identity), true, false,
                    Reasons("BasicWorkDay", p.Basic, s, identity, WithIdentity(p.Basic, identity)));

            case DayClassification.ObservationDay:
                return new RewardStamp(WithIdentity(p.ObservationBonus, identity), true, true,
                    Reasons("ObservationDay", p.ObservationBonus, s, identity, WithIdentity(p.ObservationBonus, identity)));

            case DayClassification.LearningDay:
                return new RewardStamp(WithIdentity(p.LearningBonus, identity), true, true,
                    Reasons("LearningDay", p.LearningBonus, s, identity, WithIdentity(p.LearningBonus, identity)));

            case DayClassification.DeclaredNoWorkDay:
                {
                    var isRest = s.NoWorkReasonCode is { } code
                        && RestReasons.Contains(code, StringComparer.OrdinalIgnoreCase);
                    var advances = isRest
                        ? !DfesTuning.Streak.NeutralOnRestDay      // rest day: neutral unless configured otherwise
                        : DfesTuning.Streak.AdvanceOnDeclaredNoWork; // external blocker
                    return new RewardStamp(WithIdentity(p.NoWork, identity), advances, false,
                        Reasons("DeclaredNoWorkDay", p.NoWork, s, identity, WithIdentity(p.NoWork, identity)));
                }

            // UnaccountedDay = neutral (no advance, no break — Phase 3 grace window).
            // PendingReconciliation = non-breaking pause. Both earn nothing.
            default:
                return new RewardStamp(WithIdentity(0, identity), false, false,
                    Reasons(classification.ToString(), 0, s, identity, WithIdentity(0, identity)));
        }
    }

    // The day's own points plus its product-answer points, never past the daily cap.
    private static int WithIdentity(int dayPoints, IdentityPoints identity) =>
        Math.Min(dayPoints + identity.Total(DfesTuning.Points), DfesTuning.DailyPointCap);

    // Compact, deterministic reason string (no System.Text.Json in Domain). With no product-answer points the string is
    // exactly what it was before the identity reasons existed.
    private static string Reasons(string classification, int basePoints, ClassifierSignals s, IdentityPoints identity, int total)
    {
        var bonuses = new List<string>();
        if (s.HasStructuredObservation) bonuses.Add($"\"observation:{DfesTuning.Points.ObservationBonus}\"");
        if (s.HasLearning) bonuses.Add($"\"learning:{DfesTuning.Points.LearningBonus}\"");
        if (s.HasFollowup) bonuses.Add($"\"followup:{DfesTuning.Points.FollowupBonus}\"");
        for (var i = 0; i < identity.ProductConfirmed; i++) bonuses.Add($"\"productConfirmed:{DfesTuning.Points.ProductConfirmed}\"");
        for (var i = 0; i < identity.EvidenceMatch; i++) bonuses.Add($"\"evidenceMatch:{DfesTuning.Points.EvidenceMatch}\"");
        for (var i = 0; i < identity.GapFilledLater; i++) bonuses.Add($"\"gapFilledLater:{DfesTuning.Points.GapFilledLater}\"");
        return $"{{\"classification\":\"{classification}\",\"base\":{basePoints}," +
               $"\"bonuses\":[{string.Join(",", bonuses)}]," +
               $"\"total\":{total},\"cap\":{DfesTuning.DailyPointCap}}}";
    }
}
