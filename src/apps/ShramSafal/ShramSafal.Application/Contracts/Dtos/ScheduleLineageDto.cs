namespace ShramSafal.Application.Contracts.Dtos;

public sealed record ScheduleLineageDto(
    Guid Id,
    string Name,
    int Version,
    Guid? CreatedByUserId,
    string? CreatedByDisplayName,
    string TenantScope,
    DateTime? PublishedAtUtc,
    Guid? DerivedFromTemplateId,
    Guid? PreviousVersionId);
