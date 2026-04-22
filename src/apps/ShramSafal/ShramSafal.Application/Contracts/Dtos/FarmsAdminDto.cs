namespace ShramSafal.Application.Contracts.Dtos;

public sealed record FarmsListDto(
    IReadOnlyList<FarmSummaryDto> Items,
    int TotalCount,
    int Page,
    int PageSize);

public sealed record FarmSummaryDto(
    Guid FarmId,
    string Name,
    string OwnerPhone,
    string Plan,
    decimal? Wvfd7d,
    string? EngagementTier,
    int Errors24h,
    DateTime? LastLogAt,
    DateTime CreatedAt);

public sealed record SilentChurnItemDto(
    Guid FarmId,
    string Name,
    string OwnerPhone,
    string Plan,
    int WeeksSilent,
    DateTime? LastLogAt);

public sealed record SufferingItemDto(
    Guid FarmId,
    string Name,
    int ErrorCount,
    int SyncErrors,
    int LogErrors,
    int VoiceErrors,
    DateTime LastErrorAt);
