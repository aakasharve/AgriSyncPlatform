namespace ShramSafal.Application.UseCases.Schedules.AbandonSchedule;

public sealed record AbandonScheduleCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid ActorUserId,
    string? ReasonText = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    // spec: plr-d10 lane L8b-1 — when the phone says the change was made (sync only; MU §11.2 late window). Null online.
    DateTime? DecidedAtUtc = null,
    // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - which followed schedule to let go. Null = the plot-season's one Active schedule
    // (every phone before this lane, P11); several followed and none named: ScheduleChoiceNeeded, nothing changed.
    Guid? SubscriptionId = null);
