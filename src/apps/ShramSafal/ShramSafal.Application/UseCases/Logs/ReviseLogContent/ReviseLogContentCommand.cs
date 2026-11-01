namespace ShramSafal.Application.UseCases.Logs.ReviseLogContent;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — an edit to what Sathi understood
/// for one log (<c>revise_log_content</c>).
/// </summary>
/// <param name="DailyLogId">The log being edited.</param>
/// <param name="BaseVersion">The record version the editor saw (an older one is accepted and recorded).</param>
/// <param name="ContentJson">The new content document, already checked at the sync boundary.</param>
/// <param name="Reason">Why, in his words, when he gave one.</param>
/// <param name="ActorUserId">Who sent it (the authenticated caller, never a payload claim).</param>
/// <param name="ActorRole">The role the caller CLAIMED — recorded, never trusted for authority.</param>
/// <param name="ClientRequestId">The phone's request id for this mutation.</param>
public sealed record ReviseLogContentCommand(
    Guid DailyLogId,
    int BaseVersion,
    string ContentJson,
    string? Reason,
    Guid ActorUserId,
    string? ActorRole = null,
    string? ClientRequestId = null,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    // lane MU-3 fix 1 (F8) — was the copy this edit was made on sent WITHOUT its amounts? The phone says so
    // (true / false), and the server follows what the phone was SENT, whatever the editor's authority is when the
    // edit arrives. null = a phone that does not say (1.0.17 and older): the editor's authority now decides, as
    // before fix 1.
    bool? AmountsWithheld = null);
