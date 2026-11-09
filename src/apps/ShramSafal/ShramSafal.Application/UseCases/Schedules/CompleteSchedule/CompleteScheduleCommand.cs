namespace ShramSafal.Application.UseCases.Schedules.CompleteSchedule;

public sealed record CompleteScheduleCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid ActorUserId,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - which followed schedule to complete (REST only). Null = the plot-season's one
    // Active schedule (P11); several followed and none named: ScheduleChoiceNeeded, nothing changed.
    Guid? SubscriptionId = null);
