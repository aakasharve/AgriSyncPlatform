namespace ShramSafal.Application.UseCases.Planning.MoveScheduleStep;

/// <summary>
/// spec: plr-d10 lane ATT-W (R29) - "पुढे ठरवा" on a step a FOLLOWED schedule asks. <see cref="OriginalDate"/> is the day the schedule
/// itself asks the step (one of <c>ScheduleFollowEngine.Expand</c>'s dates for that activity); <see cref="NewDate"/> is the day लक्ष द्या
/// should remind instead. Ids and dates only: no reason text (the move is the record).
/// </summary>
public sealed record MoveScheduleStepCommand(
    Guid FarmId,
    Guid SubscriptionId,
    Guid ActivityId,
    DateOnly OriginalDate,
    DateOnly NewDate,
    Guid CallerUserId,
    string? ClientAppVersion = null,
    string AuditDeviceId = "unknown",
    string AuditIpHash = "unknown");
