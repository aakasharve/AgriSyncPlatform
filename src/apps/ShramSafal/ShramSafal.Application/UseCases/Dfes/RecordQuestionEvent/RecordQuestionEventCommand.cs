namespace ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;

/// <summary>
/// Append-only telemetry for ONE shown/answered D8 question. Fields map 1:1 onto
/// ssf.question_events columns (LOCKED). CallerUserId is the JWT subject (auth);
/// the remaining fields come straight from the client's selected bank entry.
/// </summary>
public sealed record RecordQuestionEventCommand(
    Guid CallerUserId, Guid FarmId, Guid? PlotId, Guid? DailyLogId,
    string QuestionKey, string Crop, string? ExpectedStage, string? ActualStageApplicability,
    string AnchorDateType, string TriggerType, string QuestionType, string Lens,
    int DepthLevel, int Priority, int Cooldown, string AnswerModes, string SafetyClass,
    bool AgronomistApproved, bool MarathiApproved, string BankVersion, string QuestionEngineVersion,
    Guid? AnswerObservationId, DateTime? ShownAtUtc, string? TriggerReason, string? WeatherContext,
    string? Response, bool? StageConfirmed, bool? PhotoSubmitted, bool? Skipped,
    // Lane DFES-Q (founder D-B, D-D, D-G, 2026-11-21) — all optional; an older phone sends none of them (P11).
    // There is deliberately NO source field: the phone names the look lines it used and the SERVER resolves their sources.
    string? PromptText = null,
    string? PromptOrigin = null,
    IReadOnlyList<string>? LookLineIds = null,
    string? ScheduleCardRef = null,
    string? DeviationReasonCode = null,
    string? DeviationChallenge = null,
    Guid? PhotoAttachmentId = null);
