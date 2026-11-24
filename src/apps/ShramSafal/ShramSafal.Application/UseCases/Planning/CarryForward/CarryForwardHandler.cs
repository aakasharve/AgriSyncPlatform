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

namespace ShramSafal.Application.UseCases.Planning.CarryForward;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 3 "At season end ask once")
//
// At the end of a season the farmer's own schedule becomes next season's own schedule, asking once where the season's practice differed. This writes COPIES in the new
// season (own works, their revisions, their origins, one answer row each) and NOTHING else: it never changes the main schedule, a plan or a log (the guardrail), and the
// season that ended keeps every row it had (P3).
//
// Who may (SM-10): the same gate as taking into my schedule: the own-schedule gate (the owner, or a seat holding "पीक वेळापत्रकाचे नमुने") AND the planning permission.
// A worker never reaches it.
//
// The copy: TIMERS, never dates (a day from pruning, after a work, when seen), so the dates follow the new pruning. "मी केलं तसं" takes the recorded day (as a stored day from
// the pruning of the season that ended) only where there is a record; a log task states no quantity today, so a quantity is never taken (nothing is invented, P4). The origin
// of the copy is exactly the previous work's current origin: the same schedule owner, schedule, version and task (a withdrawn source stays withdrawn). Taken is never done: the
// copy starts as an own work with no plan and no record.
//
// Idempotent per (plot, from-season, to-season): the id of a copy is the one every save of that key has (new season + key) and the id of an answer is a UUIDv5 of the pair and
// the key, so a replay or a second phone finds the answers and writes nothing.

/// <summary><c>ownschedule.carry_forward</c>.</summary>
public sealed class CarryForwardHandler(
    IShramSafalRepository repository, IOwnScheduleStore store, OwnScheduleMainSwitch main, ScheduleFeed feed, IClock clock)
{
    public async Task<Result<CarryForwardResult>> HandleAsync(CarryForwardCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var answers = command.Answers ?? [];
        var picks = command.PlanOnlyPicks ?? [];
        if (command.FromCropCycleId == Guid.Empty || command.ToCropCycleId == Guid.Empty || command.FromCropCycleId == command.ToCropCycleId
            || answers.Any(a => !ScheduleTaskContent.IsValidKey(a.TaskKey) || !Enum.IsDefined(a.Choice) || a.Choice == ScheduleCarryChoice.PlanOnlyPicked)
            || answers.Select(a => a.TaskKey).Distinct(StringComparer.Ordinal).Count() != answers.Count
            || picks.Any(p => !ScheduleTaskContent.IsValidKey(p.TaskKey))
            || picks.Select(p => p.TaskKey).Distinct(StringComparer.Ordinal).Count() != picks.Count)
        {
            return Result.Failure<CarryForwardResult>(ShramSafalErrors.OwnScheduleInvalid("CarryForward", "A carry names the season that ended, the next season, and each work once."));
        }

        // The season that ended, on that plot and farm (E4), then the own-schedule gate.
        var opened = await main.OpenAsync(command.FarmId, command.PlotId, command.FromCropCycleId, command.Caller.UserId, ct);
        if (!opened.IsSuccess)
        {
            return Result.Failure<CarryForwardResult>(opened.Error);
        }

        var season = opened.Value;
        var now = clock.UtcNow;

        // SM-10: the planning permission too. A worker holds neither.
        var seat = await PlannedWorkSeats.OfAsync(repository, season.FarmId, command.Caller.UserId, now, ct);
        if (!seat.Active || !(seat.IsPrimaryOwner || seat.HoldsPlanWork))
        {
            return Result.Failure<CarryForwardResult>(ShramSafalErrors.Forbidden);
        }

        // The next season: on the same plot and farm, and later than the one that ended (the code lets a plot hold a newer season only after the older one's end date).
        if (await repository.GetCropCycleByIdAsync(command.ToCropCycleId, ct) is not { } next
            || next.PlotId != season.PlotId || (Guid)next.FarmId != season.FarmId)
        {
            return Result.Failure<CarryForwardResult>(ShramSafalErrors.CropCycleNotFound);
        }

        if (next.StartDate <= season.Season.StartDate)
        {
            return Result.Failure<CarryForwardResult>(
                ShramSafalErrors.OwnScheduleInvalid("CarryNotNextSeason", "The season a work is carried into must start after the season that ended."));
        }

        // Asked once: a pair already answered is returned as it was, and nothing is written (a replay, or a second phone).
        var before = await store.GetCarriesAsync(season.PlotId, command.FromCropCycleId, command.ToCropCycleId, ct);
        if (before.Count > 0)
        {
            return Result.Success(ResultOf(command, before, replayed: true));
        }

        var view = await feed.ReadAsync(season.FarmId, season.PlotId, season.Season, ct);
        var farm = new FarmId(season.FarmId);
        var owner = new UserId(season.OwnerUserId);
        var caller = new UserId(command.Caller.UserId);
        var said = answers.ToDictionary(a => a.TaskKey, a => a.Choice, StringComparer.Ordinal);
        var written = new List<OwnScheduleSeasonCarry>();

        // The copy in the new season: a plain own work (no plan, no record), with the previous work's origin repeated; an existing work of the same key in the new season is left as it is.
        async Task<Guid?> CopyAsync(OwnScheduleItem previous, ScheduleTaskContent content)
        {
            var newId = OwnScheduleItem.IdFor(command.ToCropCycleId, previous.TaskKey);
            if (await store.GetAsync(newId, ct) is not null)
            {
                return newId;
            }

            var copy = OwnScheduleItem.Create(farm, season.PlotId, command.ToCropCycleId, owner, content, caller, now, out var revision, out _);
            if (copy is null)
            {
                return null;
            }

            store.Stage(copy);
            store.Stage(revision!);
            if (await store.GetOriginAsync(previous.Id, ct) is { } origin)
            {
                store.Stage(OwnScheduleItemOrigin.CarriedFrom(copy, origin));
            }

            return newId;
        }

        foreach (var item in view.Items.Where(i => i.State == OwnScheduleItemState.Active))
        {
            var answered = said.TryGetValue(item.TaskKey, out var choice);
            if (!answered)
            {
                choice = ScheduleCarryChoice.AsScheduled; // an unanswered work is carried as written; the answer row says so (P8)
            }

            if (choice == ScheduleCarryChoice.Skip)
            {
                written.Add(OwnScheduleSeasonCarry.Of(farm, season.PlotId, command.FromCropCycleId, command.ToCropCycleId, owner, item.TaskKey, item.Id, null, choice, answered, null, caller, now));
                continue;
            }

            int? recordedDay = null;
            if (choice == ScheduleCarryChoice.AsIDid && view.Anchor is { } anchor
                && view.Facts.TryGetValue(item.TaskKey, out var facts) && facts.ActualDate is { } actual)
            {
                recordedDay = ScheduleDayNumbers.StoredFromShown(actual.DayNumber - anchor.DayNumber + 1);
            }

            var newId = await CopyAsync(item, ScheduleCarry.Content(item.Content, choice, recordedDay, recordedDose: null));
            if (newId is null)
            {
                return Result.Failure<CarryForwardResult>(ShramSafalErrors.OwnScheduleInvalid("CarryForward", "A work of the season could not be carried."));
            }

            written.Add(OwnScheduleSeasonCarry.Of(farm, season.PlotId, command.FromCropCycleId, command.ToCropCycleId, owner, item.TaskKey, item.Id, newId, choice, answered, recordedDay, caller, now));
        }

        foreach (var carry in written)
        {
            store.Stage(carry);
        }

        // Work that was only planned and is no longer in the own schedule (a plan of a work he took out): carried ONLY when the farmer picked it, as it was written.
        var planOnly = new List<OwnScheduleSeasonCarry>();
        foreach (var pick in picks)
        {
            var gone = view.Items.FirstOrDefault(i => i.State == OwnScheduleItemState.Removed && string.Equals(i.TaskKey, pick.TaskKey, StringComparison.Ordinal)
                && view.Plans.Any(p => p.OwnItemId == i.Id && p.Status != PlannedWorkStatus.Cancelled));
            Guid? copied = gone is null ? null : await CopyAsync(gone, gone.Content);
            var row = OwnScheduleSeasonCarry.Of(
                farm, season.PlotId, command.FromCropCycleId, command.ToCropCycleId, owner, pick.TaskKey, gone?.Id, copied, ScheduleCarryChoice.PlanOnlyPicked, true, null, caller, now);
            store.Stage(row);
            planOnly.Add(row);
        }

        var all = written.Concat(planOnly).ToList();
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "OwnScheduleSeasonCarry",
                entityId: OwnScheduleSeasonCarry.IdFor(season.PlotId, command.FromCropCycleId, command.ToCropCycleId, "_pair"),
                action: "OwnScheduleSeasonCarried",
                actorUserId: command.Caller.UserId,
                actorRole: command.Caller.ActorRole,
                payload: new
                {
                    plotId = season.PlotId,
                    fromCropCycleId = command.FromCropCycleId,
                    toCropCycleId = command.ToCropCycleId,
                    carried = all.Count(c => c.NewItemId is not null),
                    skipped = all.Count(c => c.Choice == ScheduleCarryChoice.Skip),
                    keptAsWritten = all.Count(c => !c.Answered),
                },
                farmId: season.FarmId,
                clientCommandId: command.Caller.ClientCommandId,
                appVersion: command.Caller.ClientAppVersion,
                deviceId: command.Caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);
        await repository.SaveChangesAsync(ct);
        return Result.Success(ResultOf(command, all, replayed: false));
    }

    private static CarryForwardResult ResultOf(CarryForwardCommand command, IReadOnlyList<OwnScheduleSeasonCarry> rows, bool replayed) =>
        new(
            command.FromCropCycleId,
            command.ToCropCycleId,
            rows.Count(r => r.Choice != ScheduleCarryChoice.PlanOnlyPicked && r.NewItemId is not null),
            rows.Count(r => r.Choice == ScheduleCarryChoice.Skip),
            rows.Where(r => !r.Answered && r.Choice != ScheduleCarryChoice.PlanOnlyPicked).Select(r => r.TaskKey).ToList(),
            rows.Where(r => r.Choice == ScheduleCarryChoice.PlanOnlyPicked && r.NewItemId is not null).Select(r => r.TaskKey).ToList(),
            rows.Where(r => r.Choice == ScheduleCarryChoice.PlanOnlyPicked && r.NewItemId is null).Select(r => r.TaskKey).ToList(),
            replayed);
}
