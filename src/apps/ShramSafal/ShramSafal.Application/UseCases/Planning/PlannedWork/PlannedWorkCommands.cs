// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24 / D-24c).
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.PlannedWork;

/// <summary>Who sent a step and how it arrived: the authenticated sender, never a payload field, plus the audit stamps.</summary>
/// <param name="ActorUserId">The authenticated sender.</param>
/// <param name="ClientMutationId">The sync request id (null for a REST caller).</param>
public sealed record PlannedWorkCaller(
    Guid ActorUserId,
    string ActorRole = "unknown",
    string? ClientMutationId = null,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

/// <summary>
/// <c>plannedwork.create</c>: make a task or reminder. <paramref name="Details"/> holds the words; the maker, the day it was
/// made (<paramref name="RecordedOn"/>, the farm-local day: D-29) and the status are the server's.
/// </summary>
public sealed record CreatePlannedWorkCommand(
    Guid PlannedWorkId,
    Guid FarmId,
    PlannedWorkDetails Details,
    PlannedWorkSourceKind? SourceKind,
    DateOnly? RecordedOn,
    PlannedWorkCaller Caller);

/// <summary><c>plannedwork.edit</c>: replace when, where, who and what (a full replace: an omitted word is cleared).</summary>
public sealed record EditPlannedWorkCommand(
    Guid PlannedWorkId,
    Guid FarmId,
    PlannedWorkDetails Details,
    PlannedWorkCaller Caller);

/// <summary><c>plannedwork.seen</c> and <c>plannedwork.accept</c>: the assignee's answers.</summary>
public sealed record AnswerPlannedWorkCommand(Guid PlannedWorkId, Guid FarmId, PlannedWorkCaller Caller);

/// <summary><c>plannedwork.cancel</c>: stop the work, with an optional reason in his words.</summary>
public sealed record CancelPlannedWorkCommand(Guid PlannedWorkId, Guid FarmId, string? Reason, PlannedWorkCaller Caller);

/// <summary>
/// <c>plannedwork.complete</c> (lane L8c-3, founder D-24d, D-30): "काम झालं" - the work was done on these plots, with these logs.
/// <paramref name="SomethingLeft"/> = the person says more remains to be done (the work stays pending).
/// </summary>
public sealed record CompletePlannedWorkCommand(
    Guid PlannedWorkId,
    Guid FarmId,
    IReadOnlyList<Guid> PlotIds,
    IReadOnlyList<Guid> DailyLogIds,
    bool SomethingLeft,
    PlannedWorkCaller Caller);

/// <summary><c>plannedwork.reopen</c> (lane L8c-3): the primary owner says the work was not done, with his reason.</summary>
public sealed record ReopenPlannedWorkCommand(Guid PlannedWorkId, Guid FarmId, string? Reason, PlannedWorkCaller Caller);
