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
    string? Response, bool? StageConfirmed, bool? PhotoSubmitted, bool? Skipped);
