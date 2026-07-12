using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <inheritdoc cref="IDailyRichnessDerivationService"/>
public sealed class DailyRichnessDerivationService(
    IShramSafalRepository repository,
    IAiJobRepository aiJobRepository,
    IIdGenerator idGenerator,
    IClock clock) : IDailyRichnessDerivationService
{
    // Asia/Kolkata is a fixed +05:30 offset (no DST) — compute the local date
    // deterministically without depending on the host TZ database.
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

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
        var plots = await repository.GetPlotsByFarmIdAsync(farmId, ct);

        var roots = new List<JsonElement>();
        var docs = new List<JsonDocument>(); // kept alive until scoring done
        try
        {
            foreach (var log in logs)
            {
                if (log.SourceAiJobId is not { } jobId || jobId == Guid.Empty) continue;
                var job = await aiJobRepository.GetByIdAsync(jobId, ct);
                if (job?.NormalizedResultJson is not { } json || string.IsNullOrWhiteSpace(json)) continue;
                if (job.FarmId != farmId) continue; // cross-farm guard (mirrors handler FINDING 1)
                try
                {
                    var doc = JsonDocument.Parse(json);
                    docs.Add(doc);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object) roots.Add(doc.RootElement);
                }
                catch (JsonException ex)
                {
                    // Malformed NormalizedResultJson → skip this log's signals (the
                    // day's other logs still contribute). Observability event so a
                    // malformed blob is never a SILENT skip.
                    System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                        "DailyRichnessDerivationService.MalformedNormalizedResultJson",
                        tags: new System.Diagnostics.ActivityTagsCollection
                        {
                            ["exception.type"] = ex.GetType().Name,
                            ["exception.message"] = ex.Message,
                        }));
                }
            }

            var serverTodayLocal = DateOnly.FromDateTime(clock.UtcNow + IstOffset);
            var plausible = ClientDateSanity.IsPlausible(localDate, serverTodayLocal);

            var data = new DfesLensExtractor.DayData(roots, observations, plots.Count);
            var probe = new DfesLensExtractor.LensScoresProbe();
            var (input, signals) = DfesLensExtractor.Build(data, probe, plausible);
            var scores = probe.Scores;

            var classification = DayClassifier.Classify(signals);
            var stamp = RichnessStamper.Stamp(classification, signals);
            var componentsJson = JsonSerializer.Serialize(input);

            var flags = new ContributingFlags(
                signals.HasWork, signals.HasMeaningfulObservation, signals.HasLearning,
                signals.HasExperimentOutcome, signals.HasDisturbance, signals.HasDeclaredNoWorkReason);

            var existing = await repository.GetDailyRichnessAggregateAsync(farmId, localDate, ct);
            if (existing is not null)
            {
                existing.ApplyDerivation(
                    scores.ExecutionScore, scores.InsightScore, scores.LearningScore,
                    classification, flags,
                    stamp.AdvancesStreak, stamp.AdvancesBar, stamp.ShramPointsEarned,
                    stamp.RewardReasonsJson, signals.NoWorkReasonCode,
                    DfesTuning.ScoreEngineVersion, componentsJson);
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
