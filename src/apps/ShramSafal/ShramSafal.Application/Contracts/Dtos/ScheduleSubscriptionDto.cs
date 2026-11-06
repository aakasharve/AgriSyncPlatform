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
    DateTime? StateChangedAtUtc,
    // spec: plr-d10 lane L8b-1 — the plot's day 0 (null = the crop season's start). Additive, last (P11).
    DateOnly? ReferenceDate = null);
