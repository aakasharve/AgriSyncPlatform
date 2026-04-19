namespace ShramSafal.Application.Contracts.Dtos;

public sealed record ScheduleSubscriptionDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    string CropKey,
    Guid ScheduleTemplateId,
    string ScheduleVersionTag,
    DateTime AdoptedAtUtc,
    string State,
    Guid? MigratedFromSubscriptionId,
    Guid? MigratedToSubscriptionId,
    string? MigrationReason,
    DateTime? StateChangedAtUtc);
