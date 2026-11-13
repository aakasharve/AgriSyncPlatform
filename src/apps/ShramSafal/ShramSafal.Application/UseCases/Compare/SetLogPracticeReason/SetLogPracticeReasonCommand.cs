// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D3; founder D-68 round 2)
namespace ShramSafal.Application.UseCases.Compare.SetLogPracticeReason;

/// <summary>
/// One reason kept on one item of one saved record ("का केलं"), from the sync push (<c>logreason.set</c>). Never new work and never an edit of the record.
/// </summary>
/// <param name="ReasonId">The reason's own id, made on the phone: a repeat of the same id is the same row.</param>
/// <param name="FarmId">The farm the phone says the record is on; the record's own farm decides (E4).</param>
/// <param name="DailyLogId">The saved record.</param>
/// <param name="WorkKey">Which item of that record (<c>ownWork[].workKey</c> of तुलना).</param>
/// <param name="Kind"><c>Practice</c>, <c>Extra</c> or <c>Weather</c>; nothing else.</param>
/// <param name="Words">What he said (at most 1000 characters), or null.</param>
/// <param name="SaidByVoice">True when the words came from the mic.</param>
/// <param name="AuthorUserId">The authenticated sender, never a payload field.</param>
/// <param name="ClientMutationId">The sync request id (audit only).</param>
public sealed record SetLogPracticeReasonCommand(
    Guid ReasonId,
    Guid FarmId,
    Guid DailyLogId,
    string WorkKey,
    string Kind,
    string? Words,
    bool SaidByVoice,
    Guid AuthorUserId,
    string ClientMutationId,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
