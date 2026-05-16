using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Schedules.MigrateSchedule;

public sealed record MigrateScheduleCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid NewScheduleTemplateId,
    ScheduleMigrationReason Reason,
    Guid ActorUserId,
    string? ReasonText = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    Guid? NewSubscriptionId = null,
    Guid? MigrationEventId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green. Both audit emissions in MigrateScheduleHandler
    // (the legacy emit-on-prev path was consolidated to a single audit row in
    // 04.3a; the current handler emits one Migrated audit row that references
    // the new subscription, plus a ScheduleMigrationEvent) inherit the same
    // forensic provenance from this command.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
