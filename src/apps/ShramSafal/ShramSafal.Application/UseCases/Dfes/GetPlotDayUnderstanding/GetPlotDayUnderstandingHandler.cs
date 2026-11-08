using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.UseCases.Dfes.GetPlotDayUnderstanding;

/// <summary>
/// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 2; founder 2026-11-06) - how much of each plot's day the app
/// understood, DERIVED ON READ from that plot's own records and nothing stored. The farm-day score
/// (<c>GetDayUnderstandingHandler</c>) is not re-keyed; this reads the same pieces the day is scored from, with the same rules,
/// for the records of one plot.
///
/// <list type="bullet">
/// <item><b>Only its own records.</b> A plot is scored from the records whose single plot it is. A farm-level or multi-plot record
/// counts for no plot - no split is invented (P4). A plot with no record that day has no score (null, never 0) and no hint.</item>
/// <item><b>The same engine rules as the day.</b> The day's stored version decides which rules run (a day frozen on an older
/// engine is read on that engine's rules). The day's answered gap questions belong to the farm day, not to a plot, so they credit
/// no plot.</item>
/// <item><b>A day he declared no-work shows no number</b> (founder ruling 2, 2026-08-14: honesty must not be punished), the
/// same as the farm-day read.</item>
/// <item><b>The hint</b> is the unearned part with the highest weight (ties by name); "understood" lists the parts fully earned.</item>
/// <item><b>Only what the caller may see.</b> A plot outside a chosen-plots seat is not listed; a record kept from him or outside
/// his place counts for nothing. Another farm is Forbidden.</item>
/// </list>
/// Nothing here writes: no row, no points, no recompute. The score never changes a stored quantity, dose, name or date (P7).
/// </summary>
public sealed class GetPlotDayUnderstandingHandler(
    IShramSafalRepository repository,
    IAiJobRepository aiJobRepository,
    IClock clock)
{
    private readonly DayScorer scorer = new(repository, aiJobRepository, clock);

    public async Task<Result<IReadOnlyList<PlotDayUnderstandingDto>>> HandleAsync(
        GetPlotDayUnderstandingQuery query,
        CancellationToken ct = default)
    {
        if (query.FarmId == Guid.Empty || query.CallerUserId == Guid.Empty)
        {
            return Result.Failure<IReadOnlyList<PlotDayUnderstandingDto>>(ShramSafalErrors.InvalidCommand);
        }

        if (!await repository.IsUserMemberOfFarmAsync(query.FarmId, query.CallerUserId, ct))
        {
            return Result.Failure<IReadOnlyList<PlotDayUnderstandingDto>>(ShramSafalErrors.Forbidden);
        }

        var atUtc = clock.UtcNow;
        var access = await repository.GetFarmAccessForUserAsync(query.FarmId, query.CallerUserId, ct);
        if (FarmReadScope.Of(query.FarmId, access, atUtc) is not { } scope)
        {
            return Result.Failure<IReadOnlyList<PlotDayUnderstandingDto>>(ShramSafalErrors.Forbidden);
        }

        var visibility = await RecordVisibility.ForFarmAsync(repository, query.FarmId, query.CallerUserId, atUtc, ct);

        var plots = (await repository.GetPlotsByFarmIdAsync(query.FarmId, ct))
            .Where(p => (Guid)p.FarmId == query.FarmId && scope.CoversPlot(p.Id))
            .ToList();

        // The records of the day he may see, of this farm (E4).
        var logs = (await repository.GetDailyLogsForFarmDateAsync(query.FarmId, query.LocalDate, ct))
            .Where(l => (Guid)l.FarmId == query.FarmId && visibility.MaySeeLog(l.Id))
            .ToList();

        // The version the farm day was scored under decides which rules run, exactly as in the recompute; no row = the current engine.
        var scoredUnder = (await repository.GetDailyRichnessAggregateAsync(query.FarmId, query.LocalDate, ct))?.ScoreEngineVersion;

        var result = new List<PlotDayUnderstandingDto>(plots.Count);
        foreach (var plot in plots)
        {
            var plotLogs = logs.Where(l => l.PlotId == plot.Id).ToList(); // a farm-level or multi-plot record has no PlotId
            if (plotLogs.Count == 0)
            {
                result.Add(new PlotDayUnderstandingDto(plot.Id, null, [], null));
                continue;
            }

            var scored = await scorer.ScoreAsync(query.FarmId, query.LocalDate, plotLogs, scoredUnder, includeAnsweredGaps: false, ct);

            // Honesty is not punished: a day he declared as no-work shows no number and asks for nothing.
            if (DayClassifier.Classify(scored.Signals) == DayClassification.DeclaredNoWorkDay)
            {
                result.Add(new PlotDayUnderstandingDto(plot.Id, null, [], null));
                continue;
            }

            var parts = DayUnderstandingScore.ScoredParts(scored.Input);
            var understood = parts
                .Where(d => d.Coverage >= 1.0)
                .OrderByDescending(d => d.Weight).ThenBy(d => d.Name, StringComparer.Ordinal)
                .Select(d => PlotUnderstandingWords.Understood(d.Name))
                .OfType<LocalizedText>()
                .ToList();
            var hint = parts
                .Where(d => d.Coverage < 1.0)
                .OrderByDescending(d => d.Weight).ThenBy(d => d.Name, StringComparer.Ordinal)
                .Select(d => PlotUnderstandingWords.Hint(d.Name))
                .OfType<LocalizedText>()
                .FirstOrDefault();

            result.Add(new PlotDayUnderstandingDto(plot.Id, DayUnderstandingScore.From(scored.Input), understood, hint));
        }

        return Result.Success<IReadOnlyList<PlotDayUnderstandingDto>>(result);
    }
}
