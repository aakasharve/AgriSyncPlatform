namespace ShramSafal.Application.UseCases.Schedules.AdoptSchedule;

public sealed record AdoptScheduleCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid ScheduleTemplateId,
    Guid ActorUserId,
    string? ActorRole = null,
    string? ClientCommandId = null,
    Guid? SubscriptionId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
