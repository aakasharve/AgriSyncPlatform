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

    public static RewardStamp Stamp(DayClassification classification, ClassifierSignals s)
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
                    var capped = Math.Min(points, DfesTuning.DailyPointCap);
                    return new RewardStamp(capped, true, true,
                        Reasons("RichWorkDay", p.Rich, s, capped));
                }

            case DayClassification.BasicWorkDay:
                return new RewardStamp(p.Basic, true, false,
                    Reasons("BasicWorkDay", p.Basic, s, p.Basic));

            case DayClassification.ObservationDay:
                return new RewardStamp(p.ObservationBonus, true, true,
                    Reasons("ObservationDay", p.ObservationBonus, s, p.ObservationBonus));

            case DayClassification.LearningDay:
                return new RewardStamp(p.LearningBonus, true, true,
                    Reasons("LearningDay", p.LearningBonus, s, p.LearningBonus));

            case DayClassification.DeclaredNoWorkDay:
                {
                    var isRest = s.NoWorkReasonCode is { } code
                        && RestReasons.Contains(code, StringComparer.OrdinalIgnoreCase);
                    var advances = isRest
                        ? !DfesTuning.Streak.NeutralOnRestDay      // rest day: neutral unless configured otherwise
                        : DfesTuning.Streak.AdvanceOnDeclaredNoWork; // external blocker
                    return new RewardStamp(p.NoWork, advances, false,
                        Reasons("DeclaredNoWorkDay", p.NoWork, s, p.NoWork));
                }

            // UnaccountedDay = neutral (no advance, no break — Phase 3 grace window).
            // PendingReconciliation = non-breaking pause. Both earn nothing.
            default:
                return new RewardStamp(0, false, false,
                    Reasons(classification.ToString(), 0, s, 0));
        }
    }

    // Compact, deterministic reason string (no System.Text.Json in Domain).
    private static string Reasons(string classification, int basePoints, ClassifierSignals s, int total)
    {
        var bonuses = new List<string>();
        if (s.HasStructuredObservation) bonuses.Add($"\"observation:{DfesTuning.Points.ObservationBonus}\"");
        if (s.HasLearning) bonuses.Add($"\"learning:{DfesTuning.Points.LearningBonus}\"");
        if (s.HasFollowup) bonuses.Add($"\"followup:{DfesTuning.Points.FollowupBonus}\"");
        return $"{{\"classification\":\"{classification}\",\"base\":{basePoints}," +
               $"\"bonuses\":[{string.Join(",", bonuses)}]," +
               $"\"total\":{total},\"cap\":{DfesTuning.DailyPointCap}}}";
    }
}
