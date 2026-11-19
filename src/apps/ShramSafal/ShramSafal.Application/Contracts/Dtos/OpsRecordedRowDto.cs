namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a Task R1).
/// One row the failure recording wrote into <c>analytics.events</c>, read back
/// as it was stored. Facts only: nothing here is derived, grouped or judged.
///
/// <para>
/// A value that was not captured, or that cannot be read, is <c>null</c>
/// (<see cref="RejectedWorkCodes"/>: an empty list). It is never a default
/// word and never a zero (doctrine P4).
/// </para>
///
/// <para>
/// There is deliberately no phone number and no device id on this row, and no
/// place to put one.
/// </para>
/// </summary>
/// <param name="EventId">The row's own id.</param>
/// <param name="EventType">
/// <c>api.error</c>, <c>api.slow</c>, <c>api.refused</c> or
/// <c>sync.mutation_rejected</c> (written by the server), or
/// <c>client.error</c> or <c>sync.push_outcome</c> (sent by the app).
/// </param>
/// <param name="OccurredAtUtc">When it happened.</param>
/// <param name="Endpoint">The raw method and path of the request.</param>
/// <param name="Route">The method and route pattern: the same on every farm.</param>
/// <param name="StatusCode">The status the request was answered with.</param>
/// <param name="ErrorCode">The name of the error, when the response was produced from a named one.</param>
/// <param name="RejectedWorkCodes">The distinct codes of the saves refused inside the response. Never null.</param>
/// <param name="RejectedWorkItems">How many saves were refused inside the response.</param>
/// <param name="AppVersion">The app version the request, or the app's report, stated.</param>
/// <param name="ServerBuild">The server build that wrote the row.</param>
/// <param name="PersonId">
/// The signed-in person: the one the server recorded for its own rows, the
/// sender for rows the app sent. Null when the row names nobody: a
/// <c>client.error</c> that came through the app's failure reporter has no
/// sender, because that route records none.
/// </param>
/// <param name="PersonName">That person's name on record; null when there is no user record or no name.</param>
/// <param name="RouteFarmId">The farm the request addressed. Not proof the person belongs to it.</param>
/// <param name="RecoveredCount">Only on <c>sync.push_outcome</c>: saves that had failed and then arrived.</param>
/// <param name="NeedsReviewCount">Only on <c>sync.push_outcome</c>: saves sent to the farmer to review.</param>
/// <param name="PendingAfter">Only on <c>sync.push_outcome</c>: saves still waiting or failed after the cycle.</param>
public sealed record OpsRecordedRowDto(
    Guid EventId,
    string EventType,
    DateTime OccurredAtUtc,
    string? Endpoint,
    string? Route,
    int? StatusCode,
    string? ErrorCode,
    IReadOnlyList<string> RejectedWorkCodes,
    int? RejectedWorkItems,
    string? AppVersion,
    string? ServerBuild,
    Guid? PersonId,
    string? PersonName,
    Guid? RouteFarmId,
    int? RecoveredCount,
    int? NeedsReviewCount,
    int? PendingAfter);
