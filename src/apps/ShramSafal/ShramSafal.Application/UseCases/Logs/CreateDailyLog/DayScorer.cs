using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>What a set of records scores to: the roster of scored dimensions (<see cref="LensInput"/>), the classifier signals and the
/// three lens scores. Pure data; nothing is stored by building it.</summary>
internal sealed record DayScore(LensInput Input, ClassifierSignals Signals, LensScores Scores, bool ClientDatePlausible);

/// <summary>
/// The ONE place the records of a day (or of one plot's part of a day) are turned into a score: it gathers everything the
/// derivation reads (observations, the farmer's persisted rows, the parse job's JSON, the app's weather, the products and their
/// answers) and runs <see cref="DfesLensExtractor"/>. Lifted out of <see cref="DailyRichnessDerivationService"/> unchanged so the
/// per-plot read (lane IT3, Task 2) scores a plot with exactly the rules the day is scored with. It writes nothing.
/// </summary>
internal sealed class DayScorer(
    IShramSafalRepository repository,
    IAiJobRepository aiJobRepository,
    IClock clock)
{
    /// <param name="logs">The records to score together (the whole day, or one plot's).</param>
    /// <param name="scoredUnder">The version already stamped on the farm day's row, or null for a day never scored.</param>
    /// <param name="includeAnsweredGaps">The day's answered gap questions credit the day. They are the farm day's, not a plot's,
    /// so the per-plot read leaves them out.</param>
    public async Task<DayScore> ScoreAsync(
        Guid farmId,
        DateOnly localDate,
        IReadOnlyList<DailyLog> logs,
        string? scoredUnder,
        bool includeAnsweredGaps,
        CancellationToken ct)
    {
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
        IReadOnlyList<AnsweredGap> answeredGaps = includeAnsweredGaps
            ? await repository.GetAnsweredGapsAsync(farmId, localDate, ct)
            : [];

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

            // wave-3.5, Ruling 3 — the weather the APP already holds for this day. Written
            // to ssf.weather_stamps on the same unit of work as the log since
            // 20260630040851 and, until now, read by nothing.
            var weatherStamps = await repository.GetWeatherStampsForDailyLogsAsync(logIds, ct);

            // The day's plot, when it HAS one. A day whose logs span several plots passes
            // null, and the weather match becomes plot-agnostic — because a day with no
            // single plot has no single plot to be wrong about, and demanding a stamp for
            // "the" plot would silently keep the bucket owed forever on multi-plot farms.
            var plotId = logs.Select(l => (Guid?)l.PlotId).Distinct().Count() == 1
                ? (Guid?)logs[0].PlotId
                : null;

            // dfes-5 (lane IT3) - the products he named, judged from the LATEST stored content, the library's match and the
            // newest answers (never the parse job). Read for every recompute at this one point, like the answered gaps, so
            // no path can stamp a row without them.
            var judged = await ProductIdentityReader.JudgeAsync(repository, logs, ct);
            var products = logs.SelectMany(l => judged.GetValueOrDefault(l.Id) ?? []).ToList();

            var data = new DfesLensExtractor.DayData(
                roots, observations, persistedRoots, answeredGaps,
                weatherStamps, plotId, localDate, scoredUnder, products);
            var probe = new DfesLensExtractor.LensScoresProbe();
            var (input, signals) = DfesLensExtractor.Build(data, probe, plausible);
            return new DayScore(input, signals, probe.Scores, plausible);
        }
        finally
        {
            foreach (var d in docs) d.Dispose();
        }
    }
}
