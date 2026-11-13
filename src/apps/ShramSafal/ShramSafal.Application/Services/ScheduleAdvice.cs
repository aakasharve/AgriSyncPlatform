using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compare;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ADV; founder D-74 note, D-87 = 1, D-83 = 1, D-24d; R10, R12, R28; P4, E4,
/// MU-4) - "what does each schedule I follow ask for THIS work in THIS stage?", read while he plans the work. A READ of schedules only:
/// it reads no record, writes nothing, and holds no quantity and no dose (a schedule stores none).
/// <list type="bullet">
/// <item><b>Who</b>: the farm's primary account holder, or a seat holding PlanWork or AssignWork now (<see cref="PlannedWorkSeats"/>, the
/// one reading of the seat every planned-work door uses), else <c>Forbidden</c> (403). A paused, waiting or ended seat holds nothing;
/// a worker (कामगार) is refused twice (he has no authority and no overview). <b>Deliberate rule (CTO ruling, SCH-ADV fix 1):</b> advice is
/// part of the stage-plan overview right, so a seat that holds PlanWork / AssignWork but reads only its own records (own-work scope) is also
/// refused (403, fail closed) - the authority is necessary, not sufficient - and the phone draws nothing for him. The authority is asked
/// FIRST, before the plot or the schedules are looked at, so a seat without it cannot tell a real plot from a made-up one. Then the stage plan's own wall: a plot that is not on this
/// farm, does not exist or is outside the seat's chosen plots answers <c>PlotNotFound</c> (404, one body for all - E4).</item>
/// <item><b>The numbers are the stage panel's</b>: the items come out of <see cref="ScheduleStagePlan"/> (the same window, the same engine,
/// the same <c>TimesInStage</c>, never recounted here); this keeps, per schedule, the items that are the SAME WORK
/// (<see cref="WorkRecogniser.Same"/>, the stored part / role / operation key over the title). A loose "when" is today's stage (R28), and
/// in the trial it is today's stage whatever the date (R10) - both are the stage plan's.</item>
/// <item><b>Words not recognised</b> (R12): no lines. <b>He must choose a schedule first</b> (D-83 = 1): <c>NeedsSchedule</c> and no lines
/// - the read itself never refuses. <b>No stage</b> (the main schedule stores none, or the day is in none): no lines, no invented stage.</item>
/// </list>
/// </summary>
public sealed class ScheduleAdvice(
    IShramSafalRepository repository,
    ScheduleStagePlan stagePlan,
    IClock clock)
{
    /// <summary>The most of his words that are read (the task's own title limit).</summary>
    public const int MaxWordsLength = 200;

    public async Task<Result<ScheduleAdviceDto>> ForPlotAsync(
        Guid farmId, Guid plotId, Guid callerUserId, string? words, DateOnly? forDate, CancellationToken ct = default)
    {
        var seat = await PlannedWorkSeats.OfAsync(repository, farmId, callerUserId, clock.UtcNow, ct);
        if (!(seat.Active && (seat.IsPrimaryOwner || seat.HoldsPlanWork || seat.HoldsAssignWork)))
        {
            return Result.Failure<ScheduleAdviceDto>(ShramSafalErrors.Forbidden);
        }

        var read = await stagePlan.ForPlotWithWorkAsync(farmId, plotId, callerUserId, forDate, ct);
        if (!read.IsSuccess)
        {
            return Result.Failure<ScheduleAdviceDto>(read.Error);
        }

        var plan = read.Value.Plan;
        if (plan.NeedsSchedule)
        {
            return Result.Success(new ScheduleAdviceDto(plan.ServerTimeUtc, true, false, null, null, null, []));
        }

        var trimmed = (words ?? string.Empty).Trim();
        var wanted = trimmed.Length == 0
            ? null
            : WorkRecogniser.Recognise(trimmed.Length > MaxWordsLength ? trimmed[..MaxWordsLength] : trimmed);
        if (wanted is null)
        {
            return Result.Success(new ScheduleAdviceDto(plan.ServerTimeUtc, false, true, null, null, plan.Stage, []));
        }

        var lines = new List<ScheduleAdviceLineDto>();
        if (plan.Stage is not null)
        {
            foreach (var schedule in plan.Schedules)
            {
                var same = schedule.Items
                    .Where(i => read.Value.Work.TryGetValue((schedule.SubscriptionId, i.ActivityId), out var identity)
                                && identity is not null
                                && WorkRecogniser.Same(wanted, identity).Matched)
                    .ToList();
                lines.Add(new ScheduleAdviceLineDto(
                    schedule.SubscriptionId, schedule.Name, schedule.Slot, schedule.Origin, schedule.Check, same, same.Count == 0));
            }
        }

        return Result.Success(new ScheduleAdviceDto(
            plan.ServerTimeUtc, false, false, wanted.Part.ToString().ToLowerInvariant(), wanted.OperationKey, plan.Stage, lines));
    }
}
