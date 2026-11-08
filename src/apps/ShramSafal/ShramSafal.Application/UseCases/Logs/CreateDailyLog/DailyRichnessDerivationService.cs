using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <inheritdoc cref="IDailyRichnessDerivationService"/>
public sealed class DailyRichnessDerivationService(
    IShramSafalRepository repository,
    IAiJobRepository aiJobRepository,
    IIdGenerator idGenerator,
    IClock clock) : IDailyRichnessDerivationService
{
    // The scoring of a set of records lives in DayScorer, shared with the per-plot read (lane IT3, Task 2).
    private readonly DayScorer scorer = new(repository, aiJobRepository, clock);

    public async Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
    {
        var logs = await repository.GetDailyLogsForFarmDateAsync(farmId, localDate, ct);
        if (logs.Count == 0)
        {
            // Nothing recorded for the day → no aggregate (Phase 3 folds absence as neutral). spec: plr-d10 (lane OF-S fix
            // pass 2, N5) — a day LEFT empty (its only record moved to another day) keeps no old score or day type either:
            // its row goes, so every reader (day understanding, farmer engagement) sees it exactly as a day never recorded.
            if (await repository.GetDailyRichnessAggregateForUpdateAsync(farmId, localDate, ct) is { } emptied)
            {
                repository.RemoveDailyRichnessAggregate(emptied);
            }

            return;
        }

        // The version already stamped on this day's row, read BEFORE any scoring and before ApplyDerivation overwrites it: it
        // decides WHICH RULES RUN (the version guard, wave-3.5 Ruling 3). Still the TRACKED accessor, and it must stay so: the
        // .AsNoTracking() sibling returns a DETACHED entity, so ApplyDerivation + SaveChangesAsync emits NO UPDATE - silently,
        // with no exception. See the note at the ApplyDerivation call below; that bug froze farmers' day scores once already.
        var existing = await repository.GetDailyRichnessAggregateForUpdateAsync(farmId, localDate, ct);

        // Captured BEFORE ApplyDerivation writes over it. Null = a day this engine has never scored; anything older than the
        // current engine freezes the day on the rules it was actually scored under.
        var scoredUnder = existing?.ScoreEngineVersion;

        var scored = await scorer.ScoreAsync(farmId, localDate, logs, scoredUnder, includeAnsweredGaps: true, ct);
        var input = scored.Input;
        var signals = scored.Signals;
        var scores = scored.Scores;

        var classification = DayClassifier.Classify(signals);
        // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a, item 7; founder D-46) — the streak counts
        // confirmed records only. "Confirmed" is L4b's मंजूर and nothing else: the record's current status (the
        // fold of its verification events) is Verified. That status already IS "of the current version": a
        // confirmation of a version the record has moved past is refused (VerifyLogHandler), and every change to
        // what the record says re-opens it (MaterialChangeReopen, the labour-correction door). A शंका, or a
        // correction that re-opens it, therefore leaves it unconfirmed here. Read off the logs just loaded for the
        // day, so a confirmation counts on its WORK day whenever it was given. The rule itself is RichnessStamper's.
        var dayHasConfirmedRecord = logs.Any(l => l.CurrentVerificationStatus == VerificationStatus.Verified);
        // dfes-5 (lane IT3; founder D-94) - the points this day earned for product answers: the answers taken on THIS
        // farm-local day, each product once, on the day of its first counting answer. Read here, at the one point every
        // recompute goes through, so no path can stamp lower points over the row. An answer given on a later day earns on
        // that day; this day never reads it, so its points do not move.
        var identity = await ProductIdentityReader.PointsAsync(repository, farmId, localDate, ct);
        var stamp = RichnessStamper.Stamp(classification, signals, dayHasConfirmedRecord, identity);
        var componentsJson = JsonSerializer.Serialize(input);

        var flags = new ContributingFlags(
            signals.HasWork, signals.HasMeaningfulObservation, signals.HasLearning,
            signals.HasExperimentOutcome, signals.HasDisturbance, signals.HasDeclaredNoWorkReason);

        // FIX (dfes-companion-2026-07-11) — `existing` MUST come from the TRACKED
        // accessor. This is a read-modify-write: the ApplyDerivation call below mutates
        // it and the caller's SaveChangesAsync is expected to flush it. The sibling
        // GetDailyRichnessAggregateAsync is .AsNoTracking(), so it returned a DETACHED
        // entity and EF emitted NO UPDATE — silently, with no exception. Effect: only
        // the FIRST log of a day (the Create path below) ever wrote the aggregate, and
        // every recompute after it was discarded, freezing the farmer's day at
        // has_work=false / score 0 / "UnaccountedDay" on a day of real work.
        // (The read itself now happens ABOVE, before scoring — see the version guard.)
        if (existing is not null)
        {
            existing.ApplyDerivation(
                scores.ExecutionScore, scores.InsightScore, scores.LearningScore,
                classification, flags,
                stamp.AdvancesStreak, stamp.AdvancesBar, stamp.ShramPointsEarned,
                stamp.RewardReasonsJson, signals.NoWorkReasonCode,
                // wave-3.5 — a FROZEN day keeps its OWN stamp. Writing
                // DfesTuning.ScoreEngineVersion here unconditionally would make the row
                // claim an engine it was never scored under, and the guard would then
                // read the current engine on the NEXT recompute and rescore it after all — the
                // freeze would leak away one recompute at a time.
                scoredUnder ?? DfesTuning.ScoreEngineVersion, componentsJson);
            // ApplyDerivation takes no timestamp by contract — the write path owns it.
            // Without this the row's scores changed while UpdatedAtUtc still reported
            // the original creation time, which is exactly what made this recompute
            // look like it had never run during the 2026-07-19 investigation.
            existing.MarkUpdated(clock.UtcNow);
        }
        else
        {
            var agg = DailyRichnessAggregate.Create(
                idGenerator.New(), farmId, localDate, "Asia/Kolkata", clock.UtcNow);
            agg.ApplyDerivation(
                scores.ExecutionScore, scores.InsightScore, scores.LearningScore,
                classification, flags,
                stamp.AdvancesStreak, stamp.AdvancesBar, stamp.ShramPointsEarned,
                stamp.RewardReasonsJson, signals.NoWorkReasonCode,
                // Reached only when `existing` is null, so `scoredUnder` is null too
                // and this is provably the current engine. Written as the SAME
                // expression as the update branch on purpose: one rule for what a row's
                // version means, so a later refactor cannot make the two branches
                // disagree about it.
                scoredUnder ?? DfesTuning.ScoreEngineVersion, componentsJson);
            await repository.AddDailyRichnessAggregateAsync(agg, ct);
        }
    }
}
