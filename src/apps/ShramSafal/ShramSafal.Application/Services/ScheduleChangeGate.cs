using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 3: who may choose, switch, end or complete a
/// plot's schedule, and plan its work. Founder card D-73 (plan question L8-1), answered 2026-11-06, choice 1: "You, plus
/// the people you give 'कामाचं नियोजन करणे'". So: the farm's primary account holder, or a seat holding
/// <see cref="FarmAuthority.PlanWork"/> (not yet ended) — never a label (D-26) — plus the MU-4 plot rule
/// (<see cref="PlotScopeGate"/>: a seat on chosen plots changes only his plots).
/// <para>ONE gate, asked by every door: adopt / migrate / abandon / complete (REST and sync share the handlers), the
/// planned-activity doors (add / override / remove: "पुढे ठरवा") and <c>POST /plan/generate</c>.</para>
/// <para><b>Work that arrives late (MU design §11.2).</b> A schedule change the phone made offline while the person held
/// "plan work", that reaches the server after it ended, still counts — and is flagged for the owner
/// (<see cref="LateAuthorityAudit.AcceptedAfterEnd"/>) — only inside <see cref="LateArrivalWindow"/>, judged on the time
/// the phone states it was decided (<c>decidedAtUtc</c>, never later than the server's now). Anything else is refused
/// with <see cref="ShramSafalErrors.Forbidden"/>, which the sync layer keeps whole for the owner (nothing is dropped).</para>
/// <para><b>What the late window trusts (fix round 1, review L4).</b> Inside the window the server takes the phone's word
/// for when the change was decided: up to <see cref="LateArrivalWindow.DoneWithinDaysBeforeEnd"/> days before the end. So
/// a seat whose "plan work" has ended can still send a change it dates before the end, for up to
/// <see cref="LateArrivalWindow.ReceivedWithinDaysAfterEnd"/> days after it; that change is accepted AND flagged, by design
/// (MU §11.2: work done offline is not lost). A statement "in the future" is read as now; since the window needs the
/// change to have happened before the end, such a statement is always refused once the authority has ended, so that clamp
/// never decides an outcome on its own. Online doors never carry a statement: for them only "held now" counts.</para>
/// <para><b>Planned work names its farm (fix round 1, review H1).</b> A planned step carries no farm of its own (only its
/// season), so the planned-work doors first resolve the season's farm and refuse a season of another farm as not found
/// (<see cref="RefusePlannedWorkAsync"/>), before asking the authority on that farm.</para>
/// </summary>
public static class ScheduleChangeGate
{
    /// <summary>The authority the gate reads (D-73).</summary>
    public const FarmAuthority Authority = FarmAuthority.PlanWork;

    /// <summary>
    /// <c>null</c> when <paramref name="userId"/> may change the schedule of <paramref name="plotId"/> on
    /// <paramref name="farmId"/> now; otherwise the refusal (<see cref="ShramSafalErrors.Forbidden"/>, or
    /// <see cref="ShramSafalErrors.PlotScopeForbidden"/> for a plot outside his chosen plots). Both codes end in
    /// ".Forbidden": a REST door answers 403 and every phone parks the change visibly (P10).
    /// </summary>
    public static async Task<Error?> RefuseAsync(
        IShramSafalRepository repository, Guid farmId, Guid? plotId, Guid userId, DateTime nowUtc, CancellationToken ct = default) =>
        (await DecideAsync(repository, farmId, plotId, userId, nowUtc, decidedAtUtc: null, ct)).Refusal;

    /// <summary>
    /// The whole decision, late arrival included. <paramref name="decidedAtUtc"/>: when the phone says the change was
    /// made (null for an online door, or an older phone: then only "held now" counts).
    /// </summary>
    public static async Task<ScheduleChangeDecision> DecideAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid? plotId,
        Guid userId,
        DateTime nowUtc,
        DateTime? decidedAtUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        // The phone's statement is trusted only up to the server's own now: a decision "in the future" is decided now.
        DateTime? happened = null;
        if (decidedAtUtc is { } stated)
        {
            var utc = ToUtc(stated);
            happened = utc > nowUtc ? nowUtc : utc;
        }

        var (standing, endedAtUtc) = await FarmAuthorityGate.StandingAsync(
            repository, farmId, userId, Authority, nowUtc, happened, ct);
        if (standing is not (AuthorityStanding.HeldNow or AuthorityStanding.HeldWhenItHappened))
        {
            return ScheduleChangeDecision.Refused(ShramSafalErrors.Forbidden);
        }

        if (plotId is { } plot
            && await PlotScopeGate.RefuseAsync(repository, farmId, plot, userId, nowUtc, ct) is { } outsidePlots)
        {
            return ScheduleChangeDecision.Refused(outsidePlots);
        }

        return standing == AuthorityStanding.HeldWhenItHappened
            ? new ScheduleChangeDecision(null, AcceptedAfterAuthorityEnded: true, endedAtUtc, happened)
            : ScheduleChangeDecision.Allowed;
    }

    /// <summary>The authority half alone (no plot, no late window): may this person plan this farm's work now?</summary>
    public static Task<bool> MayChangeAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default) =>
        FarmAuthorityGate.HoldsAsync(repository, farmId, userId, Authority, nowUtc, ct);

    /// <summary>
    /// spec: plr-d10 lane L8b-1 fix round 1 (review H1, E4 both ways) — the gate of the planned-work doors (add, move and
    /// remove a step: "पुढे ठरवा"), asked by their authorizers and their handlers alike. A step and its season name no farm
    /// the phone may choose: the season <paramref name="cropCycleId"/> (the one a new step goes into, or the step's own) is
    /// read under the named farm's scope and must BE that farm's — missing, or another farm's, it is
    /// <paramref name="notFound"/> (so nothing tells a caller another farm's step exists). Only then: the authority on that
    /// farm (<see cref="MayChangeAsync"/>), then the MU-4 plot rule on the season's plot.
    /// <para>Before this, the doors asked PlanWork on whichever farm the body named, and <c>ssf.planned_activities</c> has
    /// no farm of its own and no row policy: the owner of ANY farm, naming his own, moved, removed or added steps of
    /// another farm's season.</para>
    /// </summary>
    public static async Task<Error?> RefusePlannedWorkAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid cropCycleId,
        Guid userId,
        DateTime nowUtc,
        Error notFound,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(notFound);
        if (farmId == Guid.Empty || cropCycleId == Guid.Empty
            || await repository.GetCropCycleByIdAsync(cropCycleId, ct) is not { } season
            || (Guid)season.FarmId != farmId)
        {
            return notFound;
        }

        if (!await MayChangeAsync(repository, farmId, userId, nowUtc, ct))
        {
            return ShramSafalErrors.Forbidden;
        }

        return await PlotScopeGate.RefuseCycleAsync(repository, farmId, cropCycleId, userId, nowUtc, ct);
    }

    /// <summary>
    /// spec: plr-d10 lane L8c-1 (E4) — the SAME "belongs to this farm" rule as <see cref="RefusePlannedWorkAsync"/>, for the
    /// PLOTS a task names (a task carries plots, not a season): every plot is read under the named farm's scope and must BE
    /// that farm's — missing, or another farm's, it is <paramref name="notFound"/>, exactly as an unknown plot answers, so
    /// nothing tells a caller another farm's plot exists. Asked by the task doors before they ask any authority on the farm.
    /// </summary>
    public static async Task<Error?> RefusePlotsOfFarmAsync(
        IShramSafalRepository repository,
        Guid farmId,
        IEnumerable<Guid> plotIds,
        Error notFound,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(plotIds);
        ArgumentNullException.ThrowIfNull(notFound);
        if (farmId == Guid.Empty)
        {
            return notFound;
        }

        foreach (var plotId in plotIds.Distinct())
        {
            if (plotId == Guid.Empty
                || await repository.GetPlotByIdAsync(plotId, ct) is not { } plot
                || (Guid)plot.FarmId != farmId)
            {
                return notFound;
            }
        }

        return null;
    }

    /// <summary>
    /// The owner's flag for a change accepted after "plan work" ended (MU design §11.2): one audit row on the subscription
    /// it changed. Nothing when the decision was an ordinary one. It is a RECORD only: no phone and no server read shows it
    /// to the owner yet (fix round 1, review L2: the orchestrator routes it to lane MU-1's kept-work card).
    /// </summary>
    public static async Task FlagIfLateAsync(
        IShramSafalRepository repository,
        ScheduleChangeDecision decision,
        Guid subscriptionId,
        string change,
        Guid farmId,
        Guid actorUserId,
        string actorRole,
        DateTime receivedAtUtc,
        string? clientCommandId,
        string? appVersion,
        string deviceId,
        string ipHash,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(decision);
        if (!decision.AcceptedAfterAuthorityEnded)
        {
            return;
        }

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleSubscription",
                entityId: subscriptionId,
                action: LateAuthorityAudit.AcceptedAfterEnd,
                actorUserId: actorUserId,
                actorRole: actorRole,
                payload: new
                {
                    subscriptionId,
                    change,
                    authority = FarmAuthorities.NameOf(Authority),
                    happenedAtUtc = decision.DecidedAtUtc,
                    authorityEndedAtUtc = decision.AuthorityEndedAtUtc,
                    receivedAtUtc,
                },
                farmId: farmId,
                clientCommandId: clientCommandId,
                appVersion: string.IsNullOrWhiteSpace(appVersion) || appVersion == "unknown"
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : appVersion,
                deviceId: deviceId,
                ipHash: ipHash,
                sourceAiJobId: null),
            ct);
    }

    private static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };
}

/// <summary>spec: plr-d10 lane L8b-1 — what <see cref="ScheduleChangeGate.DecideAsync"/> answered.</summary>
public sealed record ScheduleChangeDecision(
    Error? Refusal,
    bool AcceptedAfterAuthorityEnded,
    DateTime? AuthorityEndedAtUtc,
    DateTime? DecidedAtUtc)
{
    public static readonly ScheduleChangeDecision Allowed = new(null, false, null, null);

    public static ScheduleChangeDecision Refused(Error refusal) => new(refusal, false, null, null);
}
