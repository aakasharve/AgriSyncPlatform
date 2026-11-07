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
    string AuditIpHash = "sha256:unknown",
    // spec: plr-d10 lane L8b-1 — the plot's day 0 (null = the crop season's start; an old phone sends none, P11).
    DateOnly? ReferenceDate = null,
    // spec: plr-d10 lane L8b-1 — when the phone says the change was made (sync only; MU §11.2 late window). Null online.
    DateTime? DecidedAtUtc = null);
