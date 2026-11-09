using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-a; D-99 layout B, R10, R28, R34, P4, E4) - "what do my schedules
/// ask in this stage?" for ONE plot, read by the phone's stage panel (and later SCH-ADV). Thin client: the numbers are computed here,
/// by the one engine (<see cref="ScheduleFollowEngine"/>) from the days the schedules STORE; the phone never recounts them.
/// <list type="bullet">
/// <item><b>Who</b>: a seat that reads the farm's overview (<see cref="FarmReadGate"/>), else <c>Forbidden</c> (403); a plot that is
/// not on this farm, does not exist, or is outside the seat's chosen plots answers <c>PlotNotFound</c> (404, one body for all - E4).</item>
/// <item><b>The window</b> (R28): the मुख्य schedule's stage that holds the day asked (<c>forDate</c>, else today in the farm's
/// day). In the trial it is today's stage whatever <c>forDate</c> says (R10). No stored मुख्य stage, or the day in none: no stage and no
/// items (P4: no invented stage).</item>
/// <item><b>Per schedule</b>: the engine's plan for that window from the schedule's OWN day 0, so a second schedule is counted
/// inside the मुख्य schedule's window; <c>Days</c> are dates minus the मुख्य day 0 (the plot's one day count). Both <c>Days</c> and
/// <c>TimesInStage</c> are null exactly when the days are not stored.</item>
/// <item><b>Order</b>: outside places 1, 2, 3 (then a row with none), his own last. His own schedule has no check (D-82 = 3).</item>
/// <item><b>When he must choose first</b> (<see cref="PlotPlanningState.NeedsSchedule"/>): nothing is counted.</item>
/// </list>
/// No done count and no quantity is ever read here (P4); the comparison owns "how many were done".
/// </summary>
public sealed class ScheduleStagePlan(
    IShramSafalRepository repository,
    ScheduleRequirement requirement,
    IClock clock)
{
    public async Task<Result<PlotStagePlanDto>> ForPlotAsync(
        Guid farmId, Guid plotId, Guid callerUserId, DateOnly? forDate, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var scope = await FarmReadGate.ScopeAsync(repository, farmId, callerUserId, now, ct);
        if (scope is not { SeeFarmOverview: true })
        {
            return Result.Failure<PlotStagePlanDto>(ShramSafalErrors.Forbidden);
        }

        var plot = plotId == Guid.Empty ? null : await repository.GetPlotByIdAsync(plotId, ct);
        if (plot is null || (Guid)plot.FarmId != farmId || !scope.CoversPlot(plotId))
        {
            return Result.Failure<PlotStagePlanDto>(ShramSafalErrors.PlotNotFound);
        }

        var gathered = await requirement.FactsForPlotAsync(farmId, plotId, callerUserId, ct);
        if (!gathered.IsSuccess)
        {
            return Result.Failure<PlotStagePlanDto>(gathered.Error);
        }

        var facts = gathered.Value;
        var state = ScheduleRequirement.Decide(facts);
        if (state.NeedsSchedule || facts.Season is not { } season)
        {
            return Result.Success(new PlotStagePlanDto(now, plotId, state.NeedsSchedule, null, []));
        }

        var followed = ScheduleRequirement.FollowedNow(facts, season);
        var byId = facts.Listing.GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First());
        var main = MainSchedule.Pick(followed, MainScheduleFactsReader.FromListing(facts.Listing));

        // The window: the मुख्य schedule's stage holding the day (R28); in the trial, today's (R10).
        var today = FarmLocalDay.From(now);
        var day = state.InTrial ? today : forDate ?? today;
        var mainDayZero = main is null ? (DateOnly?)null : main.ReferenceDate ?? season.StartDate;
        (Domain.Planning.StageDefinition Stage, StageWindow Window)? window = null;
        if (main is not null && byId.TryGetValue(main.ScheduleTemplateId.Value, out var mainTemplate))
        {
            window = ScheduleDefinitionMapper.StageHolding(ScheduleDefinitionMapper.From(mainTemplate), mainDayZero!.Value, day);
        }

        var ordered = followed
            .OrderBy(s => s.Origin == ScheduleOrigin.Own ? 1 : 0)
            .ThenBy(s => s.Slot is { } slot ? (int)slot : int.MaxValue)
            .ThenBy(s => s.AdoptedAtUtc)
            .ThenBy(s => s.Id)
            .ToList();

        var schedules = new List<StagePlanScheduleDto>();
        foreach (var sub in ordered)
        {
            if (!byId.TryGetValue(sub.ScheduleTemplateId.Value, out var template))
            {
                continue; // a schedule he may not read is never described
            }

            var isOwn = sub.Origin == ScheduleOrigin.Own;
            IReadOnlyList<StagePlanItemDto> items = [];
            if (window is { } w)
            {
                var def = ScheduleDefinitionMapper.From(template);
                var ownDayZero = sub.ReferenceDate ?? season.StartDate;
                items = ScheduleFollowEngine.StagePlan(def, ownDayZero, w.Window)
                    .Select(p => ToItem(p, def, mainDayZero!.Value))
                    .ToList();
            }

            schedules.Add(new StagePlanScheduleDto(
                sub.Id,
                template.Id,
                template.Name,
                sub.Slot,
                (sub.Origin ?? ScheduleOrigin.Outside).ToString(),
                main is not null && sub.Id == main.Id,
                isOwn ? null : template.Check,
                items));
        }

        var windowDto = window is { } found
            ? new StagePlanWindowDto(found.Stage.Name, found.Stage.StartDay, found.Stage.EndDay, today.DayNumber - mainDayZero!.Value.DayNumber)
            : null;
        return Result.Success(new PlotStagePlanDto(now, plotId, false, windowDto, schedules));
    }

    private static StagePlanItemDto ToItem(StageActivityPlan plan, ScheduleDefinition def, DateOnly mainDayZero)
    {
        var days = plan.Dates?.Select(d => d.DayNumber - mainDayZero.DayNumber).ToList();
        var afterTitle = plan.AfterActivityId is { } after
            ? def.Activities.FirstOrDefault(a => a.ActivityId == after)?.Title
            : null;
        return new StagePlanItemDto(
            plan.ActivityId,
            plan.Part,
            plan.Title,
            plan.OperationKey,
            plan.FrequencyMode?.ToString(),
            plan.IntervalDays,
            days,
            days?.Count,
            afterTitle);
    }
}
