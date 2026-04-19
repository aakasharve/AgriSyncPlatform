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
    Guid? MigrationEventId = null);
