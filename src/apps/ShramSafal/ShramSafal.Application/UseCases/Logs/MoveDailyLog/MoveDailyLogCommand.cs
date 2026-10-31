namespace ShramSafal.Application.UseCases.Logs.MoveDailyLog;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; founder TAP-1, D-61 = 5A) — move a SAVED record to
/// another place and/or another day (<c>move_daily_log</c>).
/// </summary>
/// <param name="DailyLogId">The record being moved.</param>
/// <param name="BaseVersion">The record version he saw. An OLDER one is refused: a move is never applied over a newer change.</param>
/// <param name="NewPlotIds">The plot(s) he chose (one plot, or several); null = the place does not change.</param>
/// <param name="WholeFarm">He chose संपूर्ण शेत.</param>
/// <param name="NewLogDate">The day he chose; null = the day does not change.</param>
/// <param name="Reason">Why, in his words, when he gave one.</param>
/// <param name="RevisedAtUtc">When the phone made the change (recorded, never trusted for ordering).</param>
/// <param name="ActorUserId">Who sent it (the authenticated caller, never a payload claim).</param>
/// <param name="ActorRole">The role the caller CLAIMED — recorded, never trusted for authority.</param>
/// <param name="ClientRequestId">The phone's request id for this mutation.</param>
/// <param name="MoneyLines">
/// fix pass 2 (orchestrator call) — the lines of the record that STATED an amount on the moving phone (the phone's own
/// rule for making money from a line). Each names its money by (kind, line id); the server derives the id under THIS
/// record's id, so a line can never name another record's money. Every one must be found, or the move is refused.
/// </param>
public sealed record MoveDailyLogCommand(
    Guid DailyLogId,
    int BaseVersion,
    IReadOnlyList<Guid>? NewPlotIds,
    bool WholeFarm,
    DateOnly? NewLogDate,
    string? Reason,
    DateTime? RevisedAtUtc,
    Guid ActorUserId,
    string? ActorRole = null,
    string? ClientRequestId = null,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    IReadOnlyList<MoveMoneyLine>? MoneyLines = null);

/// <summary>One line of the record that stated an amount: its kind (<c>MoneyEntryIdentity</c> kinds) and its line id.</summary>
public sealed record MoveMoneyLine(string Kind, string LineId);
