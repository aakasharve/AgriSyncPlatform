using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning.OwnSchedule;
using ShramSafal.Application.UseCases.Planning.PlannedWork;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Planning.TakeScheduleTask;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// ONE tap puts a work of a schedule the plot follows into the farmer's own schedule, with its origin. This REPLACES rule R13 "never copied" and the D-24e2 hold:
// the copy is deliberate, one work at a time, and it keeps where it came from for ever. The guardrail of the approved spec binds: a take writes the own work, its
// revision, its origin and one audit line - NOTHING else. No plan, no assignee, and the main schedule is never touched ("plan", then who, is the farmer's second
// act: ownschedule.item.plan). Removing the own work later is "take back" through the existing remove door; the origin row stays.
//
// Who may (SM-10): both the schedule permission (the own-schedule gate: the farm's owner or a seat holding "पीक वेळापत्रकाचे नमुने") and the planning permission
// (the owner or a seat holding PlanWork). Planning permission alone plans only what is already there.
//
// The id of the own work is the one every save of this key has (crop season + key), so a second tap, a second person and two phones that take the same work give ONE
// work. A key that is already an own work made by hand is not overwritten (the take is refused, permanent); one already taken from any schedule is left as it is.

/// <summary><c>schedule.take_task</c>.</summary>
public sealed class TakeScheduleTaskHandler(
    IShramSafalRepository repository, IOwnScheduleStore store, OwnScheduleMainSwitch main, IClock clock)
{
    public async Task<Result<TakeScheduleTaskResult>> HandleAsync(TakeScheduleTaskCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.SourceVersionId == Guid.Empty || !ScheduleTaskContent.IsValidKey(command.TaskKey)
            || command.Dose is { Length: 0 or > ScheduleTaskContent.MaxLongText })
        {
            return Result.Failure<TakeScheduleTaskResult>(ShramSafalErrors.OwnScheduleInvalid("ScheduleTake", "A take names the schedule version, the work and, if it picked one, a dose."));
        }

        // The plot and the season on that farm (E4), then the schedule permission.
        var opened = await main.OpenAsync(command.FarmId, command.PlotId, command.CropCycleId, command.Caller.UserId, ct);
        if (!opened.IsSuccess)
        {
            return Result.Failure<TakeScheduleTaskResult>(opened.Error);
        }

        var season = opened.Value;
        var now = clock.UtcNow;

        // SM-10: the planning permission too.
        var seat = await PlannedWorkSeats.OfAsync(repository, season.FarmId, command.Caller.UserId, now, ct);
        if (!seat.Active || !(seat.IsPrimaryOwner || seat.HoldsPlanWork))
        {
            return Result.Failure<TakeScheduleTaskResult>(ShramSafalErrors.Forbidden);
        }

        // The source: a version this plot-season follows RIGHT NOW (not one it used to follow, not one it never did) and which is not withdrawn.
        var follows = (await repository.GetActiveScheduleSubscriptionsAsync(season.PlotId, season.Season.Id, ct))
            .Any(s => s.ScheduleTemplateId.Value == command.SourceVersionId);
        if (!follows || await repository.GetScheduleTemplateWithTasksByIdAsync(command.SourceVersionId, ct) is not { } source)
        {
            return Result.Failure<TakeScheduleTaskResult>(
                ShramSafalErrors.OwnScheduleInvalid("TakeSourceNotFollowed", "This plot does not follow that schedule, so nothing is taken from it."));
        }

        var checks = await repository.GetScheduleChecksAsync([source.Id], ct);
        if (ScheduleCheck.StateOf(checks) == ScheduleCheckState.Withdrawn)
        {
            return Result.Failure<TakeScheduleTaskResult>(
                ShramSafalErrors.OwnScheduleInvalid("TakeSourceWithdrawn", "This schedule has been withdrawn, so nothing more is taken from it."));
        }

        // Spec decision 5 ("following opens after the check"), also here: a reference (a Public row) is taken from only while its check is Checked. A followed own or team
        // schedule needs no check. (A withdrawn one was refused above.)
        if (source.TenantScope == TenantScope.Public && ScheduleCheck.StateOf(checks) != ScheduleCheckState.Checked)
        {
            return Result.Failure<TakeScheduleTaskResult>(
                ShramSafalErrors.OwnScheduleInvalid("TakeSourceNotChecked", "This schedule has not been checked, so nothing is taken from it."));
        }

        var task = source.Tasks.FirstOrDefault(t => string.Equals(t.TaskKey, command.TaskKey, StringComparison.Ordinal));
        if (task is null)
        {
            return Result.Failure<TakeScheduleTaskResult>(
                ShramSafalErrors.OwnScheduleInvalid("TakeTaskUnknown", "That schedule has no work with this key."));
        }

        // The dose he picked must be one the work states (its own dose or a line of its products): never a dose the source does not say.
        string? chosen = null;
        if (command.Dose is { } picked)
        {
            var offered = new List<string>();
            if (task.Content.Dose is { Length: > 0 } own)
            {
                offered.Add(own);
            }

            offered.AddRange((task.Content.Products ?? []).Select(p => p.DoseAsWritten).Where(d => !string.IsNullOrWhiteSpace(d)).Select(d => d!));
            if (!offered.Contains(picked, StringComparer.Ordinal))
            {
                return Result.Failure<TakeScheduleTaskResult>(
                    ShramSafalErrors.OwnScheduleInvalid("TakeDoseUnknown", "That dose is not one this work states."));
            }

            chosen = picked;
        }

        var itemId = OwnScheduleItem.IdFor(season.Season.Id, command.TaskKey);
        var work = await store.GetAsync(itemId, ct);
        var origin = work is null ? null : await store.GetOriginAsync(itemId, ct);
        var today = PlannedWorkDoor.FarmLocalDay(now);
        var caller = new UserId(command.Caller.UserId);

        if (work is not null && origin is null)
        {
            // An own work made by hand under this key: the take does not overwrite what the farmer wrote.
            return Result.Failure<TakeScheduleTaskResult>(
                ShramSafalErrors.OwnScheduleInvalid("TakeKeyInUse", "This plot's own schedule already has a work with this key."));
        }

        if (work is not null && origin is not null && work.State == OwnScheduleItemState.Active)
        {
            // Already in the own schedule (a second tap, a second person, the other schedule's copy of the same work): one work, one origin, the same result.
            return Result.Success(ResultOf(work, origin, taken: false));
        }

        // The content of the copy: the work as the source states it, with its dose picked and its origin text. The key stays the source's.
        var content = (chosen is null ? task.Content : task.Content with { Dose = chosen }).Normalized() with { Origin = OwnScheduleItemOrigin.TextFor(source.Id) };
        OwnScheduleItemRevision? revision;
        if (work is null)
        {
            work = OwnScheduleItem.Create(
                new FarmId(season.FarmId), season.PlotId, season.Season.Id, new UserId(season.OwnerUserId), content, caller, now, out revision, out var problem);
            if (work is null)
            {
                return Result.Failure<TakeScheduleTaskResult>(ShramSafalErrors.OwnScheduleInvalid(problem!.Code, problem.Message));
            }

            origin = OwnScheduleItemOrigin.Of(work, source, chosen, caller, today, now);
            store.Stage(work);
            store.Stage(origin);
        }
        else if (!work.Retake(content, new UserId(season.OwnerUserId), caller, now, out revision, out var problem))
        {
            return Result.Failure<TakeScheduleTaskResult>(ShramSafalErrors.OwnScheduleInvalid(problem!.Code, problem.Message));
        }
        else
        {
            // A work taken before and taken back is put back by THIS take: the copy now holds this take's words, so this take is its origin. Origin is history, one row per take
            // act: the new row is appended (sequence + 1) and the earlier rows never change; the current origin of the work is the latest row.
            origin = OwnScheduleItemOrigin.Of(work, source, chosen, caller, today, now, origin!.Sequence + 1);
            store.Stage(origin);
        }

        if (revision is not null)
        {
            store.Stage(revision);
        }

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "OwnScheduleItem",
                entityId: work.Id,
                action: "ScheduleTaskTaken",
                actorUserId: command.Caller.UserId,
                actorRole: command.Caller.ActorRole,
                payload: new
                {
                    plotId = work.PlotId,
                    cropCycleId = work.CropCycleId,
                    taskKey = work.TaskKey,
                    sourceVersionId = source.Id,
                    originSourceVersionId = origin!.SourceVersionId,
                    revision = work.Revision,
                    contentHash = work.ContentHash,
                    dose = chosen,
                },
                farmId: season.FarmId,
                clientCommandId: command.Caller.ClientCommandId,
                appVersion: command.Caller.ClientAppVersion,
                deviceId: command.Caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);

        // No plan, no move of the main schedule: the work and its origin only, saved in the push's one transaction.
        await repository.SaveChangesAsync(ct);
        return Result.Success(ResultOf(work, origin, taken: true));
    }

    private static TakeScheduleTaskResult ResultOf(OwnScheduleItem work, OwnScheduleItemOrigin origin, bool taken) =>
        new(
            work.Id,
            work.TaskKey,
            work.Revision,
            work.State == OwnScheduleItemState.Active ? "active" : "removed",
            work.ContentHash,
            taken,
            origin.SourceVersionId,
            origin.TakenOn.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture));
}
