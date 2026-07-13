namespace ShramSafal.Domain.Dfes;

/// <summary>All signals the 7-state classifier + reward stamper need for one
/// (Farm, LocalDate). Booleans are unioned across every DailyLog of that day.</summary>
public sealed record ClassifierSignals(
    bool ClientDatePlausible,
    bool HasWork,
    bool IsSilent,
    bool HasMeaningfulObservation,
    bool HasLearning,
    bool HasExperimentOutcome,
    bool HasDisturbance,
    bool HasDeclaredNoWorkReason,
    string? NoWorkReasonCode,
    int? ExecutionScore,
    int? InsightScore,
    int? LearningScore,
    bool HasStructuredObservation,
    bool HasFollowup);

/// <summary>Deterministic 7-state day classifier ("score truthful noticing, not
/// completeness"). Pure — no DfesTuning, no I/O.</summary>
public static class DayClassifier
{
    // Engine thresholds for "rich" (NOT DfesTuning tunables — they shape the score
    // engine, not the reward economy). A work day is RICH only when execution is
    // solid AND the farmer noticed something (observation/learning) or the day
    // reads as insight-heavy.
    private const int RichExecutionFloor = 60;
    private const int RichInsightFloor = 50;

    public static DayClassification Classify(ClassifierSignals s)
    {
        if (!s.ClientDatePlausible) return DayClassification.PendingReconciliation;

        if (s.HasWork)
        {
            var noticed = s.HasMeaningfulObservation || s.HasLearning
                          || (s.InsightScore ?? 0) >= RichInsightFloor;
            return (s.ExecutionScore ?? 0) >= RichExecutionFloor && noticed
                ? DayClassification.RichWorkDay
                : DayClassification.BasicWorkDay;
        }

        // No work — noticing beats a bare no-work declaration.
        if (s.HasLearning || s.HasExperimentOutcome) return DayClassification.LearningDay;
        if (s.HasMeaningfulObservation) return DayClassification.ObservationDay;
        if (s.HasDeclaredNoWorkReason) return DayClassification.DeclaredNoWorkDay;
        return DayClassification.UnaccountedDay;
    }
}
