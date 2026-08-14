using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
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
    public async Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
    {
        var logs = await repository.GetDailyLogsForFarmDateAsync(farmId, localDate, ct);
        if (logs.Count == 0)
        {
            return; // nothing recorded for the day → no aggregate (Phase 3 folds absence as neutral)
        }

        // Gather the day's persisted signals.
        var logIds = logs.Select(l => l.Id).ToList();
        var observations = await repository.GetObservationEventsForDailyLogsAsync(logIds, ct);

        // FIX (task-7, 2026-08-13) — the rest of the farmer's PERSISTED spine. The
        // scorer previously saw only the AI job's NormalizedResultJson (plus an
        // activity-titles-only fallback), so a labour engagement, an irrigation, a
        // machine or a disturbance he recorded was worth nothing unless an AI job
        // happened to restate it. These are now read for EVERY log and folded in
        // alongside the AI root, never instead of it.
        var labourByLog = (await repository.GetLabourAssignmentsForDailyLogsAsync(logIds, ct))
            .GroupBy(x => x.DailyLogId).ToDictionary(g => g.Key, g => (IReadOnlyList<Domain.Farms.LabourAssignment>)[.. g]);
        var irrigationByLog = (await repository.GetIrrigationEntriesForDailyLogsAsync(logIds, ct))
            .GroupBy(x => x.DailyLogId).ToDictionary(g => g.Key, g => (IReadOnlyList<Domain.Farms.IrrigationEntry>)[.. g]);
        var machineryByLog = (await repository.GetMachineryUsagesForDailyLogsAsync(logIds, ct))
            .GroupBy(x => x.DailyLogId).ToDictionary(g => g.Key, g => (IReadOnlyList<Domain.Farms.MachineryUsage>)[.. g]);
        var disturbanceByLog = (await repository.GetDisturbanceEventsForDailyLogsAsync(logIds, ct))
            .GroupBy(x => x.DailyLogId).ToDictionary(g => g.Key, g => (IReadOnlyList<Domain.Farms.DisturbanceEvent>)[.. g]);

        // task-3 (2026-08-14), founder ruling A — what the farmer told Sathi about this
        // day. Loaded HERE, inside RecomputeAsync, rather than by any caller: the roster
        // this feeds is PERSISTED and read back, so a recompute path that omitted the
        // answered gaps would overwrite the row with a lower score and slide the farmer
        // backwards for having answered. Loading it at the single point every path goes
        // through makes that impossible to forget.
        var answeredGaps = await repository.GetAnsweredGapsAsync(farmId, localDate, ct);

        var roots = new List<JsonElement>();
        var persistedRoots = new List<JsonElement>();
        var docs = new List<JsonDocument>(); // kept alive until scoring done
        try
        {
            foreach (var log in logs)
            {
                if (log.SourceAiJobId is { } jobId && jobId != Guid.Empty)
                {
                    var job = await aiJobRepository.GetByIdAsync(jobId, ct);
                    if (job?.NormalizedResultJson is { } json && !string.IsNullOrWhiteSpace(json)
                        && job.FarmId == farmId) // cross-farm guard (mirrors handler FINDING 1)
                    {
                        try
                        {
                            var doc = JsonDocument.Parse(json);
                            docs.Add(doc);
                            if (doc.RootElement.ValueKind == JsonValueKind.Object)
                            {
                                roots.Add(doc.RootElement);
                            }
                        }
                        catch (JsonException ex)
                        {
                            // Malformed NormalizedResultJson → this log's AI-JSON signal is
                            // unusable (falls through to the persisted-work fallback below).
                            // Observability event so a malformed blob is never a SILENT skip.
                            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                                "DailyRichnessDerivationService.MalformedNormalizedResultJson",
                                tags: new System.Diagnostics.ActivityTagsCollection
                                {
                                    ["exception.type"] = ex.GetType().Name,
                                    ["exception.message"] = ex.Message,
                                }));
                        }
                    }
                }

                // FIX (dfes-companion-2026-07-11, "scorer bug" — a real day of work was
                // scored 0/10 UnaccountedDay): a DailyLog with no usable AI-job JSON root
                // (no SourceAiJobId — manual entry / offline sync — or a dropped
                // provenance link, or a cross-farm/malformed job) contributed NOTHING to
                // the day's signals, even when the farmer's actual recorded work was
                // sitting right there in the DB.
                //
                // WIDENED (task-7, 2026-08-13): that fallback only synthesised activity
                // TITLES from LogTask rows, and only for a log with no AI root — so the
                // scorer still could not see a labour engagement, an irrigation, a
                // machine or a disturbance, and a manual-entry day could never be scored
                // as well as a voice day carrying the same facts. The persisted root is
                // now built for EVERY log from ALL of its typed children, and folded in
                // ALONGSIDE the AI root (DfesLensExtractor takes the better of the two
                // per dimension) rather than instead of it. Still never fabricated: only
                // non-null persisted columns are emitted, and a log with no typed child
                // yields no root at all.
                if (PersistedDayRootBuilder.Build(
                        log,
                        labourByLog.GetValueOrDefault(log.Id, []),
                        irrigationByLog.GetValueOrDefault(log.Id, []),
                        machineryByLog.GetValueOrDefault(log.Id, []),
                        disturbanceByLog.GetValueOrDefault(log.Id, [])) is { } persistedJson)
                {
                    var doc = JsonDocument.Parse(persistedJson);
                    docs.Add(doc);
                    persistedRoots.Add(doc.RootElement);
                }
            }

            var serverTodayLocal = FarmLocalDay.From(clock.UtcNow);
            var plausible = ClientDateSanity.IsPlausible(localDate, serverTodayLocal);

            var data = new DfesLensExtractor.DayData(roots, observations, persistedRoots, answeredGaps);
            var probe = new DfesLensExtractor.LensScoresProbe();
            var (input, signals) = DfesLensExtractor.Build(data, probe, plausible);
            var scores = probe.Scores;

            var classification = DayClassifier.Classify(signals);
            var stamp = RichnessStamper.Stamp(classification, signals);
            var componentsJson = JsonSerializer.Serialize(input);

            var flags = new ContributingFlags(
                signals.HasWork, signals.HasMeaningfulObservation, signals.HasLearning,
                signals.HasExperimentOutcome, signals.HasDisturbance, signals.HasDeclaredNoWorkReason);

            // FIX (dfes-companion-2026-07-11) — MUST be the TRACKED accessor. This is a
            // read-modify-write: the ApplyDerivation call below mutates `existing` and the
            // caller's SaveChangesAsync is expected to flush it. The sibling
            // GetDailyRichnessAggregateAsync is .AsNoTracking(), so it returned a DETACHED
            // entity and EF emitted NO UPDATE — silently, with no exception. Effect: only
            // the FIRST log of a day (the Create path below) ever wrote the aggregate, and
            // every recompute after it was discarded, freezing the farmer's day at
            // has_work=false / score 0 / "UnaccountedDay" on a day of real work.
            var existing = await repository.GetDailyRichnessAggregateForUpdateAsync(farmId, localDate, ct);
            if (existing is not null)
            {
                existing.ApplyDerivation(
                    scores.ExecutionScore, scores.InsightScore, scores.LearningScore,
                    classification, flags,
                    stamp.AdvancesStreak, stamp.AdvancesBar, stamp.ShramPointsEarned,
                    stamp.RewardReasonsJson, signals.NoWorkReasonCode,
                    DfesTuning.ScoreEngineVersion, componentsJson);
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
                    DfesTuning.ScoreEngineVersion, componentsJson);
                await repository.AddDailyRichnessAggregateAsync(agg, ct);
            }
        }
        finally
        {
            foreach (var d in docs) d.Dispose();
        }
    }

}
