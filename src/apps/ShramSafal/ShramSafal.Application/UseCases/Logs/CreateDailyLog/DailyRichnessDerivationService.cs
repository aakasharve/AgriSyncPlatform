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

        var roots = new List<JsonElement>();
        var docs = new List<JsonDocument>(); // kept alive until scoring done
        try
        {
            foreach (var log in logs)
            {
                var contributedAiRoot = false;

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
                                contributedAiRoot = true;
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
                // provenance link, or a cross-farm/malformed job) previously contributed
                // NOTHING to the day's signals, even when the farmer's actual recorded
                // work (LogTask rows — see AddLogTaskHandler) was sitting right there in
                // the DB. That made DfesLensExtractor.HasWork false and the day
                // classified UnaccountedDay — "nothing happened" — for a farmer who
                // worked all day. This is a SAFETY-NET FALLBACK ONLY: it never runs when
                // an AI-JSON root was already contributed above (that stays the richer,
                // preferred source), and it only reflects work that is genuinely
                // persisted (ExecutionStatus Completed/Partial/Modified — i.e. the task
                // actually happened, not Skipped/Delayed) — never fabricated.
                if (!contributedAiRoot && BuildPersistedWorkFallbackJson(log) is { } fallbackJson)
                {
                    var doc = JsonDocument.Parse(fallbackJson);
                    docs.Add(doc);
                    roots.Add(doc.RootElement);
                }
            }

            var serverTodayLocal = DateOnly.FromDateTime(clock.UtcNow + IstOffset);
            var plausible = ClientDateSanity.IsPlausible(localDate, serverTodayLocal);

            var data = new DfesLensExtractor.DayData(roots, observations);
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

    // ── persisted-work fallback (spec: dfes-companion-2026-07-11) ──────────────
    // Statuses that mean the farmer actually DID the task that day. Skipped /
    // Delayed explicitly mean the work did NOT happen (LogTask requires a
    // DeviationReasonCode for those) — counting them as "work" would fabricate
    // a signal the farmer never recorded, so they are deliberately excluded.
    private static readonly HashSet<ExecutionStatus> WorkDoneStatuses =
    [
        ExecutionStatus.Completed, ExecutionStatus.Partial, ExecutionStatus.Modified
    ];

    // Builds a minimal synthetic JSON root in the same shape DfesLensExtractor
    // already reads (see its "cropActivities" array reader), using ONLY the
    // log's real, already-persisted LogTask rows. Returns null when the log has
    // no task that genuinely represents completed work — in that case the day
    // legitimately has nothing to fall back to, and DfesLensExtractor correctly
    // sees no work (no dimension coverage is invented).
    private static string? BuildPersistedWorkFallbackJson(DailyLog log)
    {
        var titles = log.Tasks
            .Where(t => WorkDoneStatuses.Contains(t.ExecutionStatus) && !string.IsNullOrWhiteSpace(t.ActivityType))
            .Select(t => t.ActivityType.Trim())
            .ToList();

        if (titles.Count == 0)
        {
            return null;
        }

        var root = new
        {
            cropActivities = titles.Select(title => new { title }).ToArray()
        };
        return JsonSerializer.Serialize(root);
    }
}
