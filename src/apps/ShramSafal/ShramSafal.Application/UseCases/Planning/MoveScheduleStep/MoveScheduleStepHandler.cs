using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Planning.MoveScheduleStep;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane ATT-W (R29; founder L8-C1 note). Moves, for लक्ष द्या only, the reminder day of
/// ONE step a followed schedule asks, by APPENDING a <see cref="ScheduleStepMove"/> row (never an update: the latest row per step wins,
/// history stays, P3). The stage panel and तुलना keep the schedule's own day: nothing they read changes.
///
/// <para><b>Who</b> (never the role-based check of the planned-activity override door, D-26): <see cref="ScheduleChangeGate"/> - the primary
/// account holder or a seat that holds PlanWork now, and for a chosen-plots seat only the subscription's own plot. Asked in this order so a
/// caller learns nothing he may not: (1) the authority on the named farm alone (a worker, or a मुकादम / co-owner without PlanWork, is
/// <c>Forbidden</c> whatever id he names); (2) the subscription and its plot are read under the named farm's scope - another farm's
/// subscription or plot answers exactly like a made-up id (<see cref="ShramSafalErrors.ScheduleSubscriptionNotFound"/>, E4); (3) the plot
/// rule (<c>PlotScopeForbidden</c>).</para>
///
/// <para><b>Refused with words, nothing written:</b> a subscription that is not Active; an activity that is not an activity of its schedule;
/// an original day that is not one of that activity's <c>Expand</c> days; a new day before today (the farm's India day). A move to the day
/// the step already has is accepted and writes nothing (a re-sent request is the same request).</para>
/// </summary>
public sealed class MoveScheduleStepHandler(
    IShramSafalRepository repository,
    IScheduleStepMoveStore moves,
    GetScheduleTemplatesHandler templates,
    IIdGenerator idGenerator,
    IClock clock)
{
    /// <summary>
    /// Fix round 1 (P002): the window of a move. A new day may be at most this many days past the LATER of today and the day the schedule
    /// itself asks the step (farm-local days), so a seat can never silence a reminder for ever (a typed 9999-12-31).
    /// </summary>
    public const int MaxDaysAhead = 90;

    public async Task<Result> HandleAsync(MoveScheduleStepCommand command, CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty || command.SubscriptionId == Guid.Empty || command.ActivityId == Guid.Empty
            || command.CallerUserId == Guid.Empty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;

        // (1) the authority on the farm alone - before any read of the subscription, so a seat without PlanWork cannot tell a real id from a made-up one.
        if (await ScheduleChangeGate.RefuseAsync(repository, command.FarmId, null, command.CallerUserId, now, ct) is { } noAuthority)
        {
            return Result.Failure(noAuthority);
        }

        // (2) the subscription and its plot, both of THIS farm (E4: another farm's answers as a made-up id does).
        var subscription = await repository.GetScheduleSubscriptionByIdAsync(new ScheduleSubscriptionId(command.SubscriptionId), ct);
        if (subscription is null || (Guid)subscription.FarmId != command.FarmId)
        {
            return Result.Failure(ShramSafalErrors.ScheduleSubscriptionNotFound);
        }

        var plot = await repository.GetPlotByIdAsync(subscription.PlotId, ct);
        if (plot is null || (Guid)plot.FarmId != command.FarmId)
        {
            return Result.Failure(ShramSafalErrors.ScheduleSubscriptionNotFound);
        }

        // (3) the plot rule: a chosen-plots seat moves only his plots' steps.
        if (await ScheduleChangeGate.RefuseAsync(repository, command.FarmId, subscription.PlotId, command.CallerUserId, now, ct) is { } outsidePlots)
        {
            return Result.Failure(outsidePlots);
        }

        if (subscription.State != ScheduleSubscriptionState.Active)
        {
            return Result.Failure(ShramSafalErrors.ScheduleStepMoveInactive);
        }

        var cycle = await repository.GetCropCycleByIdAsync(subscription.CropCycleId, ct);
        if (cycle is null)
        {
            return Result.Failure(ShramSafalErrors.ScheduleSubscriptionNotFound);
        }

        // The schedule as a person who follows it reads it (the listing plus the schedules a plot already follows, R7), never the new-choice list.
        var listing = await templates.HandleAsync(command.CallerUserId, [subscription.ScheduleTemplateId.Value], ct);
        if (!listing.IsSuccess)
        {
            return Result.Failure(listing.Error);
        }

        var template = (listing.Value ?? []).FirstOrDefault(t => t.Id == subscription.ScheduleTemplateId.Value);
        if (template is null)
        {
            return Result.Failure(ShramSafalErrors.ScheduleStepNotInSchedule);
        }

        var definition = ScheduleDefinitionMapper.From(template);
        var dayZero = subscription.ReferenceDate ?? cycle.StartDate;
        var asked = ScheduleFollowEngine.Expand(definition, dayZero)
            .Any(s => s.ActivityId == command.ActivityId && s.Date == command.OriginalDate);
        if (!asked)
        {
            return Result.Failure(ShramSafalErrors.ScheduleStepNotInSchedule);
        }

        var today = FarmLocalDay.From(now);
        if (command.NewDate < today)
        {
            return Result.Failure(ShramSafalErrors.ScheduleStepMoveDate);
        }

        var from = command.OriginalDate > today ? command.OriginalDate : today;
        if (command.NewDate.DayNumber - from.DayNumber > MaxDaysAhead)
        {
            return Result.Failure(ShramSafalErrors.ScheduleStepMoveTooFar);
        }

        var latest = (await moves.GetForSubscriptionsAsync([subscription.Id], ct))
            .Where(m => m.TemplateActivityId == command.ActivityId && m.OriginalDate == command.OriginalDate)
            .OrderByDescending(m => m.MovedAtUtc)
            .FirstOrDefault();
        if ((latest?.NewDate ?? command.OriginalDate) == command.NewDate)
        {
            return Result.Success();
        }

        // The latest row wins by its time, so a row is always strictly later than the one it follows.
        var movedAt = latest is not null && now <= latest.MovedAtUtc ? latest.MovedAtUtc.AddTicks(10) : now;
        var move = ScheduleStepMove.Create(
            idGenerator.New(),
            new FarmId(command.FarmId),
            subscription.Id,
            command.ActivityId,
            command.OriginalDate,
            command.NewDate,
            new UserId(command.CallerUserId),
            movedAt);
        moves.Stage(move);

        // Doctrine P3: a change is never silent. Ids and dates only - no reason words exist.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleSubscription",
                entityId: subscription.Id,
                action: "schedule.step.moved",
                actorUserId: command.CallerUserId,
                actorRole: "user",
                payload: new
                {
                    subscriptionId = subscription.Id,
                    activityId = command.ActivityId,
                    originalDate = command.OriginalDate,
                    fromDate = latest?.NewDate ?? command.OriginalDate,
                    newDate = command.NewDate,
                },
                farmId: command.FarmId,
                clientCommandId: null,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion) || command.ClientAppVersion == "unknown"
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success();
    }
}
