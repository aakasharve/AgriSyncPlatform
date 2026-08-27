namespace ShramSafal.Domain.Dfes;

/// <summary>
/// DFES (dfes-companion-2026-07-11) — the six "what made this day count" booleans the
/// Phase-2 classifier derives from the convergent ledger, bundled so
/// <see cref="DailyRichnessAggregate.ApplyDerivation"/> takes ONE flags argument instead
/// of six positional bools. Unpacked 1:1 into the aggregate's <c>has_*</c> columns.
/// <c>default(ContributingFlags)</c> is all-false (an unaccounted day).
/// </summary>
public readonly record struct ContributingFlags(
    bool HasWork,
    bool HasMeaningfulObservation,
    bool HasLearning,
    bool HasExperimentOutcome,
    bool HasDisturbance,
    bool HasDeclaredNoWorkReason);
