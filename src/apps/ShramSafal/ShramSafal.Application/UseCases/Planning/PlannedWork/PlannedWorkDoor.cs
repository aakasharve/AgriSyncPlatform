// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24 / D-24c, D-26; E4).
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.PlannedWork;

/// <summary>
/// What the five planned-work doors share, in ONE place: finding a task of the named farm, the "every plot belongs to this
/// farm, then the authority is asked on that farm" order, the assignee rule, the audit row, and the save that tells a lost
/// race from a win. The authority rules themselves are <see cref="PlannedWorkAuthority"/> and
/// <see cref="PlannedWorkVisibility"/> (Domain).
/// </summary>
internal static class PlannedWorkDoor
{
    /// <summary>The audit entity type. Its trail is hidden from anyone who cannot see the task (AuditEndpoints).</summary>
    public const string AuditEntityType = Domain.RecordPrivacy.RecordKinds.PlannedWork;

    /// <summary>The farm-local day: the fields keep India time.</summary>
    private static readonly TimeSpan FarmLocalOffset = TimeSpan.FromHours(5.5);

    public static DateOnly FarmLocalDay(DateTime nowUtc) => DateOnly.FromDateTime(nowUtc + FarmLocalOffset);

    /// <summary>
    /// The day the task was made (D-29). The phone states its own local day; the server takes it within two days of its own
    /// farm-local day (a phone with a wrong clock is told, not trusted), and uses its own day when none is stated.
    /// </summary>
    public static DateOnly? ResolveRecordedOn(DateOnly? stated, DateTime nowUtc)
    {
        var today = FarmLocalDay(nowUtc);
        if (stated is not { } day)
        {
            return today;
        }

        return Math.Abs(day.DayNumber - today.DayNumber) <= 2 ? day : null;
    }

    /// <summary>
    /// The task with this id on THIS farm, as the caller's scope can see it, and the caller's seat — or the refusal. A task of
    /// another farm, a made-up id and (when <paramref name="mustSee"/>) a task he may not see all answer
    /// <see cref="ShramSafalErrors.PlannedWorkNotFound"/> (E4); a seat that reads nothing of the farm is
    /// <see cref="ShramSafalErrors.Forbidden"/>.
    /// </summary>
    public static async Task<(Domain.Planning.PlannedWork? Work, PlannedWorkSeat Seat, Error? Refusal)> OpenAsync(
        IShramSafalRepository repository, Guid plannedWorkId, Guid farmId, Guid actor, DateTime nowUtc, bool mustSee, CancellationToken ct)
    {
        var seat = await PlannedWorkSeats.OfAsync(repository, farmId, actor, nowUtc, ct);
        if (!seat.Active)
        {
            return (null, seat, ShramSafalErrors.Forbidden);
        }

        var work = plannedWorkId == Guid.Empty ? null : await repository.GetPlannedWorkByIdAsync(plannedWorkId, ct);
        if (work is null || (Guid)work.FarmId != farmId)
        {
            return (null, seat, ShramSafalErrors.PlannedWorkNotFound);
        }

        if (mustSee)
        {
            // Lane L8c-4: a task made from a log is no more visible than the log (asked only for a task that has a source log).
            var logHidden = work.SourceDailyLogId is not null
                && PlannedWorkSourceLog.HiddenFrom(await RecordVisibility.ForFarmAsync(repository, farmId, actor, nowUtc, ct), work);
            if (PlannedWorkVisibility.VisiblePlots(seat, work, logHidden) is null)
            {
                return (null, seat, ShramSafalErrors.PlannedWorkNotFound);
            }
        }

        return (work, seat, null);
    }

    /// <summary>
    /// The place and person rules for the words in <paramref name="details"/>, in this order: every plot belongs to the farm
    /// (the shared gate: ScheduleChangeGate), the sender covers every plot (MU-4), and the assignee — when he is someone else —
    /// is an Active member of this farm (<see cref="ShramSafalErrors.PlannedWorkAssigneeNotMember"/>) whose seat covers every
    /// plot (<see cref="ShramSafalErrors.PlannedWorkAssigneeOutsidePlots"/>). <c>null</c> when all hold.
    /// </summary>
    public static Task<Error?> RefuseForeignPlotsAsync(
        IShramSafalRepository repository, Guid farmId, PlannedWorkDetails details, CancellationToken ct) =>
        ScheduleChangeGate.RefusePlotsOfFarmAsync(repository, farmId, details.PlotIds ?? [], ShramSafalErrors.PlotNotFound, ct);

    /// <summary>
    /// Fix round 1 (L003): the rest of the place and person rules, AFTER the authority. The plot-belongs-to-farm check
    /// (<see cref="RefuseForeignPlotsAsync"/>) has already run BEFORE any authority was asked, so a caller without the
    /// authority who names another farm's plot gets the same not-found as for a made-up plot. This keeps the MU-4 plot rule
    /// for the sender and the assignee rules, which need the authority result (they read the assignee's seat).
    /// </summary>
    public static async Task<Error?> RefuseWhereAndWhoAsync(
        IShramSafalRepository repository, Guid farmId, Guid actor, PlannedWorkDetails details, bool checkAssignee, DateTime nowUtc, CancellationToken ct)
    {
        var plots = details.PlotIds ?? [];
        if (await PlotScopeGate.RefuseAsync(repository, farmId, plots.Select(p => (Guid?)p), actor, nowUtc, ct) is { } outside)
        {
            return outside;
        }

        if (checkAssignee && details.AssigneeUserId is { } assignee && assignee != actor)
        {
            var access = await repository.GetFarmAccessForUserAsync(farmId, assignee, ct);
            if (!FarmAccessPolicy.MayRead(access))
            {
                return ShramSafalErrors.PlannedWorkAssigneeNotMember;
            }

            if (access!.CoveredPlotIds is { } covered && !plots.All(covered.Contains))
            {
                return ShramSafalErrors.PlannedWorkAssigneeOutsidePlots;
            }
        }

        return null;
    }

    /// <summary>Stages the audit row of a step: exactly <c>{ PlannedWorkId, FarmId, Status, Step }</c> - no title, no words, no person (P6) - plus, on a reopen only, <c>Reason</c> (the owner's words, lane L8c-3).</summary>
    public static Task AuditAsync(
        IShramSafalRepository repository, Domain.Planning.PlannedWork work, string step, PlannedWorkCaller caller, CancellationToken ct,
        string? reason = null) =>
        repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: AuditEntityType,
                entityId: work.Id,
                action: $"PlannedWork{step}",
                actorUserId: caller.ActorUserId,
                actorRole: caller.ActorRole,
                payload: reason is null
                    ? (object)new { PlannedWorkId = work.Id, FarmId = (Guid)work.FarmId, Status = work.Status.ToString(), Step = step }
                    : new { PlannedWorkId = work.Id, FarmId = (Guid)work.FarmId, Status = work.Status.ToString(), Step = step, Reason = reason },
                farmId: (Guid)work.FarmId,
                clientCommandId: caller.ClientMutationId,
                appVersion: string.IsNullOrWhiteSpace(caller.ClientAppVersion) || caller.ClientAppVersion == "unknown"
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : caller.ClientAppVersion,
                deviceId: caller.AuditDeviceId,
                ipHash: caller.AuditIpHash,
                sourceAiJobId: null),
            ct);

    /// <summary>The task as the sender sees it (with the owner's word on its logs: lane L8c-3).</summary>
    public static async Task<PlannedWorkDto> DtoAsync(
        IShramSafalRepository repository, Domain.Planning.PlannedWork work, PlannedWorkSeat seat, CancellationToken ct) =>
        PlannedWorkDto.From(
            work,
            PlannedWorkVisibility.VisiblePlots(seat, work) ?? [],
            await PlannedWorkConfirmations.LoadAsync(repository, [work], ct));

    /// <summary>
    /// Saves the step and its audit row together. A lost race (another change to the same task was saved first) is
    /// <see cref="ShramSafalErrors.PlannedWorkStateChanged"/>; nothing of this step is kept.
    /// </summary>
    public static async Task<Result<PlannedWorkDto>> SaveAsync(
        IShramSafalRepository repository, Domain.Planning.PlannedWork work, PlannedWorkSeat seat, CancellationToken ct) =>
        await repository.TrySavePlannedWorkChangeAsync(ct)
            ? Result.Success(await DtoAsync(repository, work, seat, ct))
            : Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
}
