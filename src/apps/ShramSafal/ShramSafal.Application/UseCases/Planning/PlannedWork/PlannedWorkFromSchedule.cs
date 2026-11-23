// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.PlannedWork;

// The order is schedule work > my schedule > planning (approved spec). Saving an own work makes NO plan; "plan", then who, is the farmer's SECOND act and links the
// plan to the own work by its stable identity (own item + task key), never by a step id. Unrelated own work is planned with plannedwork.create and never enters the
// schedule. Removing, moving, postponing or cancelling a plan never edits the schedule (nothing here writes an own work). Real events move the plans that depend
// on them: a sign seen, and the record of the work a follower comes after (made, corrected or taken back). Weather never moves a date.

/// <summary><c>ownschedule.item.plan</c>: plan one own work (who is optional: none = a reminder for himself).</summary>
public sealed record PlanFromOwnScheduleCommand(
    Guid PlannedWorkId,
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    string TaskKey,
    Guid? AssigneeUserId,
    string? Note,
    DateOnly? RecordedOn,
    PlannedWorkCaller Caller);

/// <summary><c>schedule.task_event</c>: an answer about the sign of one "when seen" own work.</summary>
public sealed record RecordScheduleTaskEventCommand(
    Guid EventId,
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    string TaskKey,
    ScheduleSignAnswer Answer,
    DateOnly? ObservedOn,
    PlannedWorkCaller Caller);

/// <summary>What an answer did: the answer as kept, and the plans of the plot-season it moved.</summary>
public sealed record ScheduleTaskEventResult(Guid EventId, string TaskKey, string Answer, string ObservedOn, IReadOnlyList<Guid> MovedPlannedWorkIds);

/// <summary>
/// The one place that knows how an own work's plans follow the schedule (pure reads and staged changes; the caller saves once). The plot's day 0 is the start
/// date of the place it follows (a subscription's reference date) or else the crop season's start date. What was RECORDED for a work is the earliest daily log
/// linked to its latest Done plan (a log is the record; a plan marked done with no log is not a record, and no record is never "not done"). What was SEEN is the
/// latest decisive answer about its sign.
/// </summary>
public sealed class ScheduleFeed(IShramSafalRepository repository, IOwnScheduleStore ownStore, IScheduleFeedStore feedStore)
{
    /// <summary>One plot-season as the resolver needs it.</summary>
    public sealed record SeasonView(
        IReadOnlyList<OwnScheduleItem> Items,
        IReadOnlyDictionary<string, ScheduleTaskTiming> Timings,
        DateOnly? Anchor,
        IReadOnlyDictionary<string, ScheduleTaskFacts> Facts,
        IReadOnlyList<Domain.Planning.PlannedWork> Plans,
        IReadOnlyDictionary<string, ScheduleSignAnswer?> Answers);

    public async Task<SeasonView> ReadAsync(Guid farmId, Guid plotId, CropCycle season, CancellationToken ct)
    {
        var items = (await ownStore.GetSeasonAsync(plotId, season.Id, ct)).Where(i => (Guid)i.FarmId == farmId).ToList();
        var timings = items.Where(i => i.State == OwnScheduleItemState.Active).ToDictionary(i => i.TaskKey, i => i.Content.Timing, StringComparer.Ordinal);
        var plans = items.Count == 0 ? [] : await feedStore.GetPlansOfItemsAsync(items.Select(i => i.Id).ToList(), ct);
        var events = await feedStore.GetEventsAsync(plotId, season.Id, ct);

        // What was recorded: the earliest log of each work's latest Done plan that has a log.
        var donePlans = plans
            .Where(p => p.Status == PlannedWorkStatus.Done && p.ScheduleTaskKey is not null && AllLogs(p).Count > 0)
            .GroupBy(p => p.ScheduleTaskKey!, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.Occurrence).First(), StringComparer.Ordinal);
        var logIds = donePlans.Values.SelectMany(AllLogs).Distinct().ToList();
        var logDates = logIds.Count == 0
            ? new Dictionary<Guid, DateOnly>()
            : (await repository.GetDailyLogsForFarmByIdsAsync(new FarmId(farmId), logIds, ct))
                .Where(l => (Guid)l.FarmId == farmId)
                .ToDictionary(l => l.Id, l => l.LogDate);

        var facts = new Dictionary<string, ScheduleTaskFacts>(StringComparer.Ordinal);
        var answers = new Dictionary<string, ScheduleSignAnswer?>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            DateOnly? actual = null;
            if (donePlans.TryGetValue(item.TaskKey, out var done))
            {
                var dates = AllLogs(done).Where(logDates.ContainsKey).Select(id => logDates[id]).ToList();
                actual = dates.Count == 0 ? null : dates.Min();
            }

            var mine = events.Where(e => e.OwnItemId == item.Id).ToList();
            facts[item.TaskKey] = new ScheduleTaskFacts(actual, ScheduleSignFacts.SeenOn(mine));
            answers[item.TaskKey] = ScheduleSignFacts.LatestAnswer(mine);
        }

        return new SeasonView(items, timings, await AnchorAsync(plotId, season, ct), facts, plans, answers);
    }

    /// <summary>The resolution of one occurrence of one work in <paramref name="view"/>.</summary>
    public static ScheduleResolution Resolve(SeasonView view, OwnScheduleItem item, int occurrence)
    {
        var first = ScheduleTimerResolver.Resolve(item.TaskKey, view.Timings, view.Anchor, view.Facts);
        return ScheduleOccurrences.For(first, item.Content.Timing, occurrence);
    }

    /// <summary>
    /// Moves every OPEN plan of the plot-season to what the schedule says now, and stages one history row per plan that moved (what it said before and after,
    /// and why). Returns the plans that moved. Nothing is saved here.
    /// </summary>
    public async Task<IReadOnlyList<Domain.Planning.PlannedWork>> RecomputeAsync(
        Guid farmId, Guid plotId, CropCycle season, string cause, PlannedWorkCaller caller, DateTime nowUtc, CancellationToken ct)
    {
        var view = await ReadAsync(farmId, plotId, season, ct);
        var byId = view.Items.ToDictionary(i => i.Id);
        var moved = new List<Domain.Planning.PlannedWork>();
        foreach (var plan in view.Plans.Where(p => !p.IsClosed && p.OwnItemId is { } id && byId.ContainsKey(id)))
        {
            var item = byId[plan.OwnItemId!.Value];
            if (item.State != OwnScheduleItemState.Active)
            {
                continue; // a work taken out of the schedule leaves its plan as it stands (removing never edits a plan either way)
            }

            var before = (plan.PlannedDate, plan.ScheduleDueOn, plan.ExpectedFrom);
            if (plan.FollowSchedule(Resolve(view, item, plan.Occurrence ?? 1), view.Answers.GetValueOrDefault(item.TaskKey), nowUtc))
            {
                moved.Add(plan);
                await repository.AddAuditEventAsync(
                    AuditEventFactory.Create(
                        entityType: PlannedWorkDoor.AuditEntityType,
                        entityId: plan.Id,
                        action: "PlannedWorkFollowedSchedule",
                        actorUserId: caller.ActorUserId,
                        actorRole: caller.ActorRole,
                        payload: new
                        {
                            PlannedWorkId = plan.Id,
                            FarmId = farmId,
                            Status = plan.Status.ToString(),
                            Step = "FollowedSchedule",
                            Cause = cause,
                            PlannedDateBefore = before.PlannedDate,
                            PlannedDateAfter = plan.PlannedDate,
                            DueBefore = before.ScheduleDueOn,
                            DueAfter = plan.ScheduleDueOn,
                            ExpectedBefore = before.ExpectedFrom,
                            ExpectedAfter = plan.ExpectedFrom,
                        },
                        farmId: farmId,
                        clientCommandId: caller.ClientMutationId,
                        appVersion: string.IsNullOrWhiteSpace(caller.ClientAppVersion) || caller.ClientAppVersion == "unknown"
                            ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                            : caller.ClientAppVersion,
                        deviceId: caller.AuditDeviceId,
                        ipHash: caller.AuditIpHash,
                        sourceAiJobId: null),
                    ct);
            }
        }

        return moved;
    }

    /// <summary>A plan from the own schedule was completed or taken back (reopened): its plot-season is recomputed (the works that follow it move). No-op for any other plan.</summary>
    public async Task<IReadOnlyList<Domain.Planning.PlannedWork>> RecomputeForPlanAsync(
        Domain.Planning.PlannedWork plan, string cause, PlannedWorkCaller caller, DateTime nowUtc, CancellationToken ct)
    {
        if (plan.OwnItemId is not { } itemId
            || await ownStore.GetAsync(itemId, ct) is not { } item
            || await repository.GetCropCycleByIdAsync(item.CropCycleId, ct) is not { } season)
        {
            return [];
        }

        return await RecomputeAsync((Guid)plan.FarmId, item.PlotId, season, cause, caller, nowUtc, ct);
    }

    /// <summary>A daily log changed its day (or the plan it closed was taken back): every plot-season whose own-schedule plans link it is recomputed.</summary>
    public async Task<IReadOnlyList<Domain.Planning.PlannedWork>> RecomputeForLogAsync(
        Guid farmId, Guid dailyLogId, string cause, PlannedWorkCaller caller, DateTime nowUtc, CancellationToken ct)
    {
        var linked = await feedStore.GetSchedulePlansLinkingLogAsync(dailyLogId, ct);
        var moved = new List<Domain.Planning.PlannedWork>();
        foreach (var itemId in linked.Where(p => (Guid)p.FarmId == farmId).Select(p => p.OwnItemId!.Value).Distinct())
        {
            if (await ownStore.GetAsync(itemId, ct) is not { } item || await repository.GetCropCycleByIdAsync(item.CropCycleId, ct) is not { } season)
            {
                continue;
            }

            moved.AddRange(await RecomputeAsync(farmId, item.PlotId, season, cause, caller, nowUtc, ct));
        }

        return moved;
    }

    private async Task<DateOnly?> AnchorAsync(Guid plotId, CropCycle season, CancellationToken ct)
    {
        var places = await repository.GetActiveScheduleSubscriptionsAsync(plotId, season.Id, ct);
        var dated = places.Where(p => p.ReferenceDate is not null).OrderBy(p => p.Slot ?? short.MaxValue).FirstOrDefault();
        return dated?.ReferenceDate ?? season.StartDate;
    }

    private static IReadOnlyList<Guid> AllLogs(Domain.Planning.PlannedWork plan) =>
        plan.LinkedDailyLogIds.Concat(plan.Plots.SelectMany(p => p.LinkedDailyLogIds)).Distinct().ToList();
}

/// <summary>
/// <c>ownschedule.item.plan</c> - "plan", then who, on one own work. In order: the seat (an Active member), the plot ON the farm and the season ON the plot (E4),
/// the own work (active, of THIS plot-season; another farm's work answers as unknown), a replay of the same id, ONE open occurrence at a time (an open plan of the
/// work is the answer, whoever sent it and with whatever id: two phones planning offline give one plan), who may (<see cref="PlannedWorkAuthority.MayMake"/>,
/// planning permission: SM-10, planning alone plans only what is already there), where and who. The plan is dated when the schedule gives a due day and waits
/// otherwise; a repeating work's next occurrence comes only after the last one is closed, and none after its end.
/// </summary>
public sealed class PlanFromOwnScheduleHandler(
    IShramSafalRepository repository, IOwnScheduleStore ownStore, IScheduleFeedStore feedStore, ScheduleFeed feed, IClock clock)
{
    public async Task<Result<PlannedWorkDto>> HandleAsync(PlanFromOwnScheduleCommand command, CancellationToken ct = default)
    {
        if (command is null || command.PlannedWorkId == Guid.Empty || command.FarmId == Guid.Empty || command.PlotId == Guid.Empty
            || command.CropCycleId == Guid.Empty || command.Caller is null || command.Caller.ActorUserId == Guid.Empty
            || !ScheduleTaskContent.IsValidKey(command.TaskKey) || command.AssigneeUserId == Guid.Empty
            || command.Note is { Length: > Domain.Planning.PlannedWork.MaxNote })
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var now = clock.UtcNow;
        var actor = command.Caller.ActorUserId;
        var seat = await PlannedWorkSeats.OfAsync(repository, command.FarmId, actor, now, ct);
        if (!seat.Active)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
        }

        if (await repository.GetPlotByIdAsync(command.PlotId, ct) is not { } plot || (Guid)plot.FarmId != command.FarmId)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlotNotFound);
        }

        if (await repository.GetCropCycleByIdAsync(command.CropCycleId, ct) is not { } season
            || season.PlotId != command.PlotId || (Guid)season.FarmId != command.FarmId)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.CropCycleNotFound);
        }

        var item = await ownStore.GetAsync(OwnScheduleItem.IdFor(season.Id, command.TaskKey), ct);
        if (item is null || (Guid)item.FarmId != command.FarmId || item.PlotId != command.PlotId || item.State != OwnScheduleItemState.Active)
        {
            return Result.Failure<PlannedWorkDto>(
                ShramSafalErrors.OwnScheduleInvalid("OwnScheduleItemUnknown", "No work with this key is in this plot's own schedule."));
        }

        // A replay of the same id is the plan already kept; the id of another plan is refused.
        if (await repository.GetPlannedWorkByIdAsync(command.PlannedWorkId, ct) is { } same)
        {
            return (Guid)same.FarmId == command.FarmId && same.OwnItemId == item.Id
                ? Result.Success(await PlannedWorkDoor.DtoAsync(repository, same, seat, ct))
                : Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var plans = await feedStore.GetPlansOfItemsAsync([item.Id], ct);
        if (plans.FirstOrDefault(p => !p.IsClosed) is { } open)
        {
            return Result.Success(await PlannedWorkDoor.DtoAsync(repository, open, seat, ct)); // one open occurrence at a time
        }

        var repeats = item.Content.Timing.Repeat != ScheduleRepeatMode.Once;
        if (!repeats && plans.FirstOrDefault(p => p.Status == PlannedWorkStatus.Done) is { } done)
        {
            return Result.Success(await PlannedWorkDoor.DtoAsync(repository, done, seat, ct)); // a once-only work done is done
        }

        if (!PlannedWorkAuthority.MayMake(seat, command.AssigneeUserId))
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
        }

        var details = new PlannedWorkDetails(item.Name, PlannedWorkScope.Plot, [item.PlotId], null, null, null, command.AssigneeUserId, null, null, null, null, command.Note);
        if (await PlannedWorkDoor.RefuseWhereAndWhoAsync(repository, command.FarmId, actor, details, true, now, ct) is { } refusal)
        {
            return Result.Failure<PlannedWorkDto>(refusal);
        }

        if (PlannedWorkDoor.ResolveRecordedOn(command.RecordedOn, now) is not { } recordedOn)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        // A cancelled occurrence is closed too: the next plan of a repeating work is the next occurrence; a once-only work cancelled is planned again as #2.
        var occurrence = plans.Count == 0 ? 1 : plans.Max(p => p.Occurrence ?? 0) + 1;
        var view = await feed.ReadAsync(command.FarmId, command.PlotId, season, ct);
        var resolution = ScheduleFeed.Resolve(view, item, repeats ? occurrence : 1);
        if (repeats && ScheduleOccurrences.IsPastEnd(resolution, item.Content.Timing, view.Anchor))
        {
            return Result.Failure<PlannedWorkDto>(
                ShramSafalErrors.OwnScheduleInvalid("OwnScheduleRepeatEnded", "This repeating work has reached the end of its repeat."));
        }

        Domain.Planning.PlannedWork work;
        try
        {
            work = Domain.Planning.PlannedWork.CreateFromSchedule(
                command.PlannedWorkId, new FarmId(command.FarmId), item.Name, item.PlotId, command.AssigneeUserId, command.Note, item.Id, item.TaskKey, occurrence,
                resolution, view.Answers.GetValueOrDefault(item.TaskKey), recordedOn, actor, now);
        }
        catch (ArgumentException)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        await repository.AddPlannedWorkAsync(work, ct);
        await PlannedWorkDoor.AuditAsync(repository, work, "PlannedFromOwnSchedule", command.Caller, ct);
        if (await repository.TrySavePlannedWorkChangeAsync(ct))
        {
            return Result.Success(await PlannedWorkDoor.DtoAsync(repository, work, seat, ct));
        }

        // Another phone's plan of the same occurrence was saved first (the unique index on the work's open occurrence): that plan is the answer.
        var rival = (await feedStore.GetPlansOfItemsAsync([item.Id], ct)).FirstOrDefault(p => !p.IsClosed);
        return rival is not null
            ? Result.Success(await PlannedWorkDoor.DtoAsync(repository, rival, seat, ct))
            : Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
    }
}

/// <summary>
/// <c>schedule.task_event</c> - "दिसलं / अजून नाही / खात्री नाही" about one "when seen" own work. Who may: an Active member whose seat covers the plot (he is the
/// one standing in it). The work must be an active own work of THIS plot-season with a sign timer. The answer is appended (never edited), and every open plan
/// of the plot-season is moved to what the schedule says now, with a history row per moved plan, in one save. The day observed is the farm-local day (or the
/// day stated, never after tomorrow and never more than a season back).
/// </summary>
public sealed class RecordScheduleTaskEventHandler(
    IShramSafalRepository repository, IOwnScheduleStore ownStore, IScheduleFeedStore feedStore, ScheduleFeed feed, IClock clock)
{
    /// <summary>How far back a stated day may be.</summary>
    public const int MaxDaysBack = 400;

    public async Task<Result<ScheduleTaskEventResult>> HandleAsync(RecordScheduleTaskEventCommand command, CancellationToken ct = default)
    {
        if (command is null || command.EventId == Guid.Empty || command.FarmId == Guid.Empty || command.PlotId == Guid.Empty
            || command.CropCycleId == Guid.Empty || command.Caller is null || command.Caller.ActorUserId == Guid.Empty
            || !ScheduleTaskContent.IsValidKey(command.TaskKey) || !Enum.IsDefined(command.Answer))
        {
            return Result.Failure<ScheduleTaskEventResult>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var now = clock.UtcNow;
        var actor = command.Caller.ActorUserId;
        var seat = await PlannedWorkSeats.OfAsync(repository, command.FarmId, actor, now, ct);
        if (!seat.Active)
        {
            return Result.Failure<ScheduleTaskEventResult>(ShramSafalErrors.Forbidden);
        }

        if (await repository.GetPlotByIdAsync(command.PlotId, ct) is not { } plot || (Guid)plot.FarmId != command.FarmId)
        {
            return Result.Failure<ScheduleTaskEventResult>(ShramSafalErrors.PlotNotFound);
        }

        if (await repository.GetCropCycleByIdAsync(command.CropCycleId, ct) is not { } season
            || season.PlotId != command.PlotId || (Guid)season.FarmId != command.FarmId)
        {
            return Result.Failure<ScheduleTaskEventResult>(ShramSafalErrors.CropCycleNotFound);
        }

        if (await PlotScopeGate.RefuseAsync(repository, command.FarmId, [command.PlotId], actor, now, ct) is { } outside)
        {
            return Result.Failure<ScheduleTaskEventResult>(outside);
        }

        if (await feedStore.GetEventAsync(command.EventId, ct) is { } kept)
        {
            return (Guid)kept.FarmId == command.FarmId && kept.TaskKey == command.TaskKey && kept.CropCycleId == command.CropCycleId
                ? Result.Success(ResultOf(kept, []))
                : Result.Failure<ScheduleTaskEventResult>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var item = await ownStore.GetAsync(OwnScheduleItem.IdFor(season.Id, command.TaskKey), ct);
        if (item is null || (Guid)item.FarmId != command.FarmId || item.PlotId != command.PlotId || item.State != OwnScheduleItemState.Active)
        {
            return Result.Failure<ScheduleTaskEventResult>(
                ShramSafalErrors.OwnScheduleInvalid("OwnScheduleItemUnknown", "No work with this key is in this plot's own schedule."));
        }

        if (item.TimerKind != ScheduleTimerKind.Sign)
        {
            return Result.Failure<ScheduleTaskEventResult>(
                ShramSafalErrors.OwnScheduleInvalid("ScheduleTaskNotSign", "Only a work done when a sign is seen takes an answer about its sign."));
        }

        var today = PlannedWorkDoor.FarmLocalDay(now);
        var observed = command.ObservedOn ?? today;
        if (observed > today.AddDays(1) || observed < today.AddDays(-MaxDaysBack))
        {
            return Result.Failure<ScheduleTaskEventResult>(ShramSafalErrors.OwnScheduleInvalid("ScheduleTaskEventDay", "A sign is answered for a day that has come."));
        }

        var taskEvent = ScheduleTaskEvent.Create(
            command.EventId, new FarmId(command.FarmId), command.PlotId, season.Id, item.Id, item.TaskKey, command.Answer, observed, actor, now, out var problem);
        if (taskEvent is null)
        {
            return Result.Failure<ScheduleTaskEventResult>(ShramSafalErrors.OwnScheduleInvalid("ScheduleTaskEvent", problem ?? "The answer is not whole."));
        }

        feedStore.Stage(taskEvent);
        var moved = await feed.RecomputeAsync(command.FarmId, command.PlotId, season, $"sign:{ScheduleSignAnswers.ToWire(command.Answer)}", command.Caller, now, ct);
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleTaskEvent",
                entityId: taskEvent.Id,
                action: "ScheduleSignAnswered",
                actorUserId: actor,
                actorRole: command.Caller.ActorRole,
                payload: new
                {
                    plotId = command.PlotId,
                    cropCycleId = season.Id,
                    ownItemId = item.Id,
                    taskKey = item.TaskKey,
                    answer = ScheduleSignAnswers.ToWire(command.Answer),
                    observedOn = observed,
                    movedPlannedWork = moved.Select(p => p.Id).ToList(),
                },
                farmId: command.FarmId,
                clientCommandId: command.Caller.ClientMutationId,
                appVersion: string.IsNullOrWhiteSpace(command.Caller.ClientAppVersion) || command.Caller.ClientAppVersion == "unknown"
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.Caller.ClientAppVersion,
                deviceId: command.Caller.AuditDeviceId,
                ipHash: command.Caller.AuditIpHash,
                sourceAiJobId: null),
            ct);

        return await repository.TrySavePlannedWorkChangeAsync(ct)
            ? Result.Success(ResultOf(taskEvent, moved.Select(p => p.Id).ToList()))
            : Result.Failure<ScheduleTaskEventResult>(ShramSafalErrors.PlannedWorkStateChanged);
    }

    private static ScheduleTaskEventResult ResultOf(ScheduleTaskEvent e, IReadOnlyList<Guid> moved) =>
        new(e.Id, e.TaskKey, ScheduleSignAnswers.ToWire(e.Answer), e.ObservedOn.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), moved);
}
