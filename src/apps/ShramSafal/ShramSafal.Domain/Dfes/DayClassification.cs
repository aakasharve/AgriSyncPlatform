namespace ShramSafal.Domain.Dfes;

/// <summary>
/// DFES (dfes-companion-2026-07-11) — the 7-state classification of a farmer's
/// day, stamped onto <see cref="DailyRichnessAggregate.DayClassification"/> by the
/// Phase-2 classifier. Persisted as a string via <c>HasConversion&lt;string&gt;()</c>.
/// <para><see cref="UnaccountedDay"/> is streak-NEUTRAL (does not advance, does not
/// break within grace); <see cref="PendingReconciliation"/> is a non-breaking pause and
/// is also the UNSTAMPED default of a freshly shell-created row. The fold semantics live
/// in Phase 3, not here.</para>
/// </summary>
public enum DayClassification
{
    RichWorkDay,
    BasicWorkDay,
    ObservationDay,
    LearningDay,
    DeclaredNoWorkDay,
    UnaccountedDay,
    PendingReconciliation,
}
