using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning.OwnSchedule;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.OwnerVoice;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// What a follower does with an owner's message: HEARD (the first full play), DECIDE (accept / keep the old one / take it back) and ANSWER (a look message's two answers).
//
// THE RULE: an owner's message never changes the farmer's schedule or a job already given. Only a decision does, and only for the own-schedule gate (the farm's owner, or a seat holding
// "पीक वेळापत्रकाचे नमुने") AND the planning permission (the owner, or a seat holding PlanWork): a worker or a mukadam without both is refused (WorkerCannotDecide). Hearing writes
// one append-only fact and nothing else; "heard" is its own count, never "done". Every row is append-only: a later decision never edits an earlier one, and history is kept (P3).

public sealed record OwnerMessageHeardCommand(Guid FarmId, Guid PlotId, Guid MessageId, OwnScheduleCaller Caller);

public sealed record OwnerMessageDecideCommand(Guid FarmId, Guid PlotId, Guid CropCycleId, Guid MessageId, string Decision, OwnScheduleCaller Caller);

public sealed record OwnerMessageAnswerCommand(Guid FarmId, Guid PlotId, Guid CropCycleId, Guid MessageId, string Answer, OwnScheduleCaller Caller);

/// <summary>What a heard did. <see cref="Replayed"/>: the message was already heard on this plot (the first play stands).</summary>
public sealed record OwnerMessageHeardResult(Guid MessageId, bool Replayed);

/// <summary>What a decision did: the decision now standing, whether it was already standing (a replay or a second phone), and what an accept or take-back moved.</summary>
public sealed record OwnerMessageDecisionResult(
    Guid MessageId, string Decision, bool Replayed, Guid? ItemId, int? ItemRevision, bool ItemCreated, Guid? JobId, bool JobChanged);

public sealed record OwnerMessageAnswerResult(Guid MessageId, string Answer, bool Replayed);

/// <summary>The shared reads of the three doors.</summary>
internal static class OwnerMessageRules
{
    public const string FollowsRule = "OwnerMessageNotFollowed";

    /// <summary>The message, if row security shows it to this farm AND this plot (and season) follows its schedule or owns a copy from it.</summary>
    public static async Task<Result<ScheduleOwnerMessage>> FollowedMessageAsync(
        IOwnerVoiceStore store, Guid farmId, Guid plotId, Guid? cropCycleId, Guid messageId, CancellationToken ct)
    {
        if (messageId == Guid.Empty || await store.GetMessageAsync(messageId, ct) is not { } message
            || !await store.FollowsChainAsync(farmId, plotId, cropCycleId, message.ChainId, ct))
        {
            return Result.Failure<ScheduleOwnerMessage>(
                ShramSafalErrors.OwnScheduleInvalid(FollowsRule, "This plot does not follow the schedule this message is about, so there is nothing to hear or decide."));
        }

        return Result.Success(message);
    }

    public static string Wire(ScheduleOwnerStateKind kind) => OwnerMessageWire.Kind(kind);
}

/// <summary>The wire words of a state row's kind.</summary>
public static class OwnerMessageWire
{
    public static string Kind(ScheduleOwnerStateKind kind) => kind switch
    {
        ScheduleOwnerStateKind.Heard => "heard",
        ScheduleOwnerStateKind.Accepted => "accepted",
        ScheduleOwnerStateKind.KeptOld => "kept_old",
        ScheduleOwnerStateKind.TakenBack => "taken_back",
        _ => "answered",
    };
}

/// <summary><c>schedule.owner_message.heard</c>.</summary>
public sealed class OwnerMessageHeardHandler(IShramSafalRepository repository, IOwnerVoiceStore store, IClock clock)
{
    public async Task<Result<OwnerMessageHeardResult>> HandleAsync(OwnerMessageHeardCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.PlotId == Guid.Empty || command.MessageId == Guid.Empty || command.Caller.UserId == Guid.Empty)
        {
            return Result.Failure<OwnerMessageHeardResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        if (await repository.GetPlotByIdAsync(command.PlotId, ct) is not { } plot || (Guid)plot.FarmId != command.FarmId)
        {
            return Result.Failure<OwnerMessageHeardResult>(ShramSafalErrors.PlotNotFound);
        }

        // Hearing needs only a seat on the farm (a mukadam plays the clip on his job card): it changes nothing.
        var seat = await PlannedWorkSeats.OfAsync(repository, command.FarmId, command.Caller.UserId, now, ct);
        if (!seat.Active || await repository.GetFarmByIdAsync(command.FarmId, ct) is not { } farm)
        {
            return Result.Failure<OwnerMessageHeardResult>(ShramSafalErrors.Forbidden);
        }

        var message = await OwnerMessageRules.FollowedMessageAsync(store, command.FarmId, command.PlotId, null, command.MessageId, ct);
        if (!message.IsSuccess)
        {
            return Result.Failure<OwnerMessageHeardResult>(message.Error);
        }

        if ((await store.GetStatesAsync(command.PlotId, command.MessageId, ct)).Any(s => s.Kind == ScheduleOwnerStateKind.Heard))
        {
            return Result.Success(new OwnerMessageHeardResult(command.MessageId, Replayed: true));
        }

        store.Stage(ScheduleOwnerMessageState.Heard(new FarmId(command.FarmId), command.PlotId, farm.OwnerUserId, command.MessageId, new UserId(command.Caller.UserId), now));
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleOwnerMessage",
                entityId: command.MessageId,
                action: "ScheduleOwnerMessageHeard",
                actorUserId: command.Caller.UserId,
                actorRole: command.Caller.ActorRole,
                payload: new { plotId = command.PlotId, messageId = command.MessageId },
                farmId: command.FarmId,
                clientCommandId: command.Caller.ClientCommandId,
                appVersion: command.Caller.ClientAppVersion,
                deviceId: command.Caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);
        await repository.SaveChangesAsync(ct);
        return Result.Success(new OwnerMessageHeardResult(command.MessageId, Replayed: false));
    }
}

/// <summary><c>schedule.owner_message.answer</c>.</summary>
public sealed class OwnerMessageAnswerHandler(IShramSafalRepository repository, IOwnerVoiceStore store, OwnScheduleMainSwitch main, IClock clock)
{
    public async Task<Result<OwnerMessageAnswerResult>> HandleAsync(OwnerMessageAnswerCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        short answer;
        switch (command.Answer)
        {
            case "first":
                answer = 0;
                break;
            case "second":
                answer = 1;
                break;
            default:
                return Result.Failure<OwnerMessageAnswerResult>(
                    ShramSafalErrors.OwnScheduleInvalid("OwnerMessageAnswer", "A look message has two answers: first or second."));
        }

        var opened = await main.OpenAsync(command.FarmId, command.PlotId, command.CropCycleId, command.Caller.UserId, ct);
        if (!opened.IsSuccess)
        {
            return Result.Failure<OwnerMessageAnswerResult>(opened.Error);
        }

        var season = opened.Value;
        var now = clock.UtcNow;
        var seat = await PlannedWorkSeats.OfAsync(repository, season.FarmId, command.Caller.UserId, now, ct);
        if (!seat.Active || !(seat.IsPrimaryOwner || seat.HoldsPlanWork))
        {
            return Result.Failure<OwnerMessageAnswerResult>(ShramSafalErrors.Forbidden);
        }

        var found = await OwnerMessageRules.FollowedMessageAsync(store, season.FarmId, season.PlotId, season.Season.Id, command.MessageId, ct);
        if (!found.IsSuccess)
        {
            return Result.Failure<OwnerMessageAnswerResult>(found.Error);
        }

        if (found.Value.Kind != ScheduleOwnerMessageKind.Look)
        {
            return Result.Failure<OwnerMessageAnswerResult>(
                ShramSafalErrors.OwnScheduleInvalid("OwnerMessageNotALook", "Only a look message has two answers."));
        }

        // The first answer is kept: a second phone, or a second tap, finds it and writes nothing.
        if ((await store.GetStatesAsync(season.PlotId, command.MessageId, ct)).FirstOrDefault(s => s.Kind == ScheduleOwnerStateKind.Answered) is { } already)
        {
            return Result.Success(new OwnerMessageAnswerResult(command.MessageId, already.Answer == 0 ? "first" : "second", Replayed: true));
        }

        store.Stage(ScheduleOwnerMessageState.Answered(
            new FarmId(season.FarmId), season.PlotId, season.Season.Id, new UserId(season.OwnerUserId), command.MessageId, answer, new UserId(command.Caller.UserId), now));
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleOwnerMessage",
                entityId: command.MessageId,
                action: "ScheduleOwnerMessageAnswered",
                actorUserId: command.Caller.UserId,
                actorRole: command.Caller.ActorRole,
                payload: new { plotId = season.PlotId, cropCycleId = season.Season.Id, messageId = command.MessageId, answer = command.Answer },
                farmId: season.FarmId,
                clientCommandId: command.Caller.ClientCommandId,
                appVersion: command.Caller.ClientAppVersion,
                deviceId: command.Caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);
        await repository.SaveChangesAsync(ct);
        return Result.Success(new OwnerMessageAnswerResult(command.MessageId, command.Answer, Replayed: false));
    }
}

/// <summary><c>schedule.owner_message.decide</c>.</summary>
public sealed class OwnerMessageDecideHandler(
    IShramSafalRepository repository,
    IOwnerVoiceStore store,
    IOwnScheduleStore ownStore,
    IScheduleFeedStore feed,
    OwnScheduleMainSwitch main,
    IClock clock)
{
    public async Task<Result<OwnerMessageDecisionResult>> HandleAsync(OwnerMessageDecideCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.Decision is not ("accept" or "keep_old" or "take_back"))
        {
            return Refused("OwnerMessageDecision", "A decision is accept, keep_old or take_back.");
        }

        // The own-schedule gate (the farm's owner, or a seat holding the schedule permission), on a plot and season of THIS farm.
        var opened = await main.OpenAsync(command.FarmId, command.PlotId, command.CropCycleId, command.Caller.UserId, ct);
        if (!opened.IsSuccess)
        {
            return Result.Failure<OwnerMessageDecisionResult>(opened.Error);
        }

        var season = opened.Value;
        var now = clock.UtcNow;

        // ...AND the planning permission. A worker or a mukadam holding neither (or only one) never decides (WorkerCannotDecide).
        var seat = await PlannedWorkSeats.OfAsync(repository, season.FarmId, command.Caller.UserId, now, ct);
        if (!seat.Active || !(seat.IsPrimaryOwner || seat.HoldsPlanWork))
        {
            return Result.Failure<OwnerMessageDecisionResult>(ShramSafalErrors.Forbidden);
        }

        var found = await OwnerMessageRules.FollowedMessageAsync(store, season.FarmId, season.PlotId, season.Season.Id, command.MessageId, ct);
        if (!found.IsSuccess)
        {
            return Result.Failure<OwnerMessageDecisionResult>(found.Error);
        }

        var message = found.Value;
        if (message.Kind != ScheduleOwnerMessageKind.Change || message.NewVersionId is null)
        {
            return Refused("OwnerMessageNotAChange", "Only a change of plan is accepted or kept; a tip is heard and a look is answered.");
        }

        var decisions = (await store.GetStatesAsync(season.PlotId, command.MessageId, ct))
            .Where(s => (s.Kind is ScheduleOwnerStateKind.Accepted or ScheduleOwnerStateKind.KeptOld or ScheduleOwnerStateKind.TakenBack) && s.CropCycleId == season.Season.Id)
            .OrderBy(s => s.Sequence)
            .ToList();
        var latest = decisions.LastOrDefault();
        var caller = new UserId(command.Caller.UserId);
        var farm = new FarmId(season.FarmId);
        var owner = new UserId(season.OwnerUserId);
        var next = (latest?.Sequence ?? 0) + 1;

        switch (command.Decision)
        {
            case "keep_old":
                if (latest?.Kind == ScheduleOwnerStateKind.KeptOld)
                {
                    return Result.Success(Replay(message, latest));
                }

                if (latest?.Kind == ScheduleOwnerStateKind.Accepted)
                {
                    return Refused("OwnerMessageAlreadyAccepted", "The change was accepted: take it back to keep the old one.");
                }

                // Writes the decision only: no own work, revision, plan or log.
                var kept = ScheduleOwnerMessageState.Decided(farm, season.PlotId, season.Season.Id, owner, message.Id, ScheduleOwnerStateKind.KeptOld, next, caller, now);
                return await FinishAsync(command, season, message, kept, new OwnerMessageDecisionResult(message.Id, "kept_old", false, null, null, false, null, false), ct);

            case "take_back":
                if (latest?.Kind == ScheduleOwnerStateKind.TakenBack)
                {
                    return Result.Success(Replay(message, latest));
                }

                if (latest?.Kind != ScheduleOwnerStateKind.Accepted)
                {
                    return Refused("OwnerMessageNothingToTakeBack", "Only a change that was accepted can be taken back.");
                }

                return await TakeBackAsync(command, season, message, latest, next, ct);

            default:
                if (latest?.Kind == ScheduleOwnerStateKind.Accepted)
                {
                    return Result.Success(Replay(message, latest));
                }

                return await AcceptAsync(command, season, message, next, ct);
        }
    }

    private static OwnerMessageDecisionResult Replay(ScheduleOwnerMessage message, ScheduleOwnerMessageState standing) =>
        new(message.Id, OwnerMessageRules.Wire(standing.Kind), true, standing.ItemId, standing.ItemRevisionAfter, standing.ItemCreated, standing.JobId, false);

    private static Result<OwnerMessageDecisionResult> Refused(string rule, string words) =>
        Result.Failure<OwnerMessageDecisionResult>(ShramSafalErrors.OwnScheduleInvalid(rule, words));

    // ---- accept ---------------------------------------------------------------------------------------------------------------------------------------

    private async Task<Result<OwnerMessageDecisionResult>> AcceptAsync(
        OwnerMessageDecideCommand command, OwnScheduleSeason season, ScheduleOwnerMessage message, int sequence, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var caller = new UserId(command.Caller.UserId);
        var owner = new UserId(season.OwnerUserId);

        // The NEW version: still published and checked by someone other than its maker (a version withdrawn since is never taken), and it still has the work.
        if (await repository.GetScheduleTemplateWithTasksByIdAsync(message.NewVersionId!.Value, ct) is not { } newer
            || newer.TenantScope != TenantScope.Public || newer.ChainId != message.ChainId)
        {
            return Refused("ChangeNeedsACheckedVersion", "The new version of the schedule is no longer there.");
        }

        var checks = await repository.GetScheduleChecksAsync([newer.Id], ct);
        if (ScheduleCheck.StateOf(checks) != ScheduleCheckState.Checked
            || (newer.CreatedByUserId is { } maker && ScheduleCheck.Latest(checks)!.CheckerUserId == maker))
        {
            return Refused("ChangeNeedsACheckedVersion", "The new version of the schedule is not checked (any more), so the change is not taken.");
        }

        var task = newer.Tasks.FirstOrDefault(t => string.Equals(t.TaskKey, message.TaskKey, StringComparison.Ordinal));
        if (task is null)
        {
            return Refused("ChangeNeedsACheckedVersion", "The new version of the schedule has no such work.");
        }

        var itemId = OwnScheduleItem.IdFor(season.Season.Id, message.TaskKey);
        var work = await ownStore.GetAsync(itemId, ct);
        var origin = work is null ? null : await ownStore.GetOriginAsync(itemId, ct);
        var content = task.Content.Normalized();
        OwnScheduleItemRevision? revision;
        int? revisionBefore = null;
        var created = false;
        var existed = work is not null;

        if (work is { State: OwnScheduleItemState.Active } && origin is not null && origin.SourceChainId == message.ChainId)
        {
            // A work IN my schedule, taken from this schedule: a new revision of my own work with the new content. Its origin row never changes.
            revisionBefore = work.Revision;
            if (!work.Save(content, owner, caller, now, out revision, out var problem))
            {
                return Refused(problem!.Code, problem.Message);
            }
        }
        else if (work is not null && (work.State == OwnScheduleItemState.Active || origin is null))
        {
            // Made by hand, or taken from another schedule: the change does not overwrite what the farmer wrote.
            return Refused("OwnerMessageKeyInUse", "This plot's own schedule already has a work with this key that did not come from this schedule.");
        }
        else
        {
            // A work NOT in my schedule (followed only, or taken out again): the NEW one is taken in, with the new version as its origin (slice 9's take, no plan). It never
            // changes the schedule the plot follows.
            created = true;
            var taken = content with { Origin = OwnScheduleItemOrigin.TextFor(newer.Id) };
            var today = ShramSafal.Application.UseCases.Planning.PlannedWork.PlannedWorkDoor.FarmLocalDay(now);
            if (work is null)
            {
                work = OwnScheduleItem.Create(new FarmId(season.FarmId), season.PlotId, season.Season.Id, owner, taken, caller, now, out revision, out var createProblem);
                if (work is null)
                {
                    return Refused(createProblem!.Code, createProblem.Message);
                }

                ownStore.Stage(work);
                ownStore.Stage(OwnScheduleItemOrigin.Of(work, newer, null, caller, today, now));
            }
            else
            {
                if (!work.Retake(taken, owner, caller, now, out revision, out var retakeProblem))
                {
                    return Refused(retakeProblem!.Code, retakeProblem.Message);
                }

                ownStore.Stage(OwnScheduleItemOrigin.Of(work, newer, null, caller, today, now, origin!.Sequence + 1));
            }
        }

        if (revision is not null)
        {
            revision.NameOwnerMessage(message.Id);
            ownStore.Stage(revision);
        }

        // THEN the job made from the work, if one exists and is not done: its words follow the work, its trail restarts (the mukadam sees a changed job), and the clip
        // travels with it (the state row names the job and the message; the job's card plays the clip).
        Guid? jobId = null;
        string? titleBefore = null;
        string? quantityBefore = null;
        var jobChanged = false;
        if (existed)
        {
            var plans = await feed.GetPlansOfItemsAsync([work!.Id], ct);
            if (plans.Where(p => !p.IsClosed).OrderByDescending(p => p.Occurrence ?? 0).FirstOrDefault() is { } job)
            {
                titleBefore = job.Title;
                quantityBefore = job.QuantityText;
                var quantity = QuantityWordsOf(content);
                jobChanged = job.ChangeFromOwnerMessage(work.Name, quantity, changeQuantity: quantity is not null, now);
                jobId = job.Id;
            }
        }

        var state = ScheduleOwnerMessageState.Decided(
            new FarmId(season.FarmId), season.PlotId, season.Season.Id, owner, message.Id, ScheduleOwnerStateKind.Accepted, sequence, caller, now);
        state.RecordMoved(work!.Id, revisionBefore, work.Revision, created, jobId, titleBefore, quantityBefore);
        return await FinishAsync(
            command, season, message, state,
            new OwnerMessageDecisionResult(message.Id, "accepted", false, work.Id, work.Revision, created, jobId, jobChanged), ct);
    }

    // ---- take back: the revision before and the job again, both restored; history kept ------------------------------------------------------------------

    private async Task<Result<OwnerMessageDecisionResult>> TakeBackAsync(
        OwnerMessageDecideCommand command, OwnScheduleSeason season, ScheduleOwnerMessage message, ScheduleOwnerMessageState accepted, int sequence, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var caller = new UserId(command.Caller.UserId);
        var owner = new UserId(season.OwnerUserId);
        int? revisionNow = null;
        var jobChanged = false;

        if (accepted.ItemId is { } itemId && await ownStore.GetAsync(itemId, ct) is { } work)
        {
            OwnScheduleItemRevision? revision = null;
            if (accepted.ItemCreated)
            {
                // The accept took the new work in: taking it back takes it out again (its row and origin stay: history).
                work.Remove(owner, caller, now, out revision);
            }
            else if (accepted.ItemRevisionBefore is { } before && work.State == OwnScheduleItemState.Active)
            {
                if (await store.GetRevisionAsync(work.Id, before, ct) is not { } old)
                {
                    return Refused("OwnerMessageTakeBack", "The revision before the change is not there, so it could not be restored. Nothing was changed.");
                }

                // The content as it was, saved as a NEW revision (the revision after the accept stays in the history).
                if (!work.Save(old.Content, owner, caller, now, out revision, out var problem))
                {
                    return Refused(problem!.Code, problem.Message);
                }
            }

            if (revision is not null)
            {
                revision.NameOwnerMessage(message.Id);
                ownStore.Stage(revision);
            }

            revisionNow = work.Revision;

            // The job again: its words as they were, its trail restarted once more (he sees it changed back). A job done in the meantime is history and stays.
            if (accepted.JobId is { } jobId)
            {
                var plans = await feed.GetPlansOfItemsAsync([work.Id], ct);
                if (plans.FirstOrDefault(p => p.Id == jobId) is { IsClosed: false } job && accepted.JobTitleBefore is { Length: > 0 } title)
                {
                    jobChanged = job.ChangeFromOwnerMessage(title, accepted.JobQuantityBefore, changeQuantity: true, now);
                }
            }
        }

        var state = ScheduleOwnerMessageState.Decided(
            new FarmId(season.FarmId), season.PlotId, season.Season.Id, owner, message.Id, ScheduleOwnerStateKind.TakenBack, sequence, caller, now);
        state.RecordRestored(accepted.ItemId, revisionNow, accepted.JobId);
        return await FinishAsync(
            command, season, message, state,
            new OwnerMessageDecisionResult(message.Id, "taken_back", false, accepted.ItemId, revisionNow, accepted.ItemCreated, accepted.JobId, jobChanged), ct);
    }

    private async Task<Result<OwnerMessageDecisionResult>> FinishAsync(
        OwnerMessageDecideCommand command, OwnScheduleSeason season, ScheduleOwnerMessage message, ScheduleOwnerMessageState state, OwnerMessageDecisionResult result, CancellationToken ct)
    {
        store.Stage(state);
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleOwnerMessage",
                entityId: message.Id,
                action: "ScheduleOwnerMessageDecided",
                actorUserId: command.Caller.UserId,
                actorRole: command.Caller.ActorRole,
                payload: new
                {
                    plotId = season.PlotId,
                    cropCycleId = season.Season.Id,
                    messageId = message.Id,
                    decision = result.Decision,
                    taskKey = message.TaskKey,
                    itemId = result.ItemId,
                    itemRevision = result.ItemRevision,
                    itemCreated = result.ItemCreated,
                    jobId = result.JobId,
                },
                farmId: season.FarmId,
                clientCommandId: command.Caller.ClientCommandId,
                appVersion: command.Caller.ClientAppVersion,
                deviceId: command.Caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);
        await repository.SaveChangesAsync(ct);
        return Result.Success(result);
    }

    /// <summary>The words the job states for the new work: its dose as written, else its products and their doses as written; null when the work states none (the job's words are then left alone).</summary>
    private static string? QuantityWordsOf(ScheduleTaskContent content)
    {
        string? words = null;
        if (!string.IsNullOrWhiteSpace(content.Dose))
        {
            words = content.Dose.Trim();
        }
        else if (content.Products is { Count: > 0 })
        {
            words = string.Join("; ", content.Products
                .Where(p => !string.IsNullOrWhiteSpace(p.DoseAsWritten))
                .Select(p => $"{p.Name} {p.DoseAsWritten}".Trim()));
        }

        return string.IsNullOrWhiteSpace(words) || words.Length > global::ShramSafal.Domain.Planning.PlannedWork.MaxQuantityText ? null : words;
    }
}
