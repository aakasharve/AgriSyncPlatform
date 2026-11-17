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
    // spec: company-mis-real-numbers-2026-11-15 — always null: the farm list no longer sends a made-up plan.
    string? Plan,
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

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2). One farm with three or more problems in the
/// last 7 days on requests that named the farm. ProblemCount is every problem; the four area counts split that
/// same total (ProblemArea). No name: names come from <c>GET /shramsafal/admin/farms/contacts</c>.
/// </summary>
public sealed record SufferingItemDto(
    Guid FarmId,
    int ProblemCount,
    int SyncProblems,
    int EntryProblems,
    int VoiceProblems,
    int OtherProblems,
    DateTime LastProblemAt);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1). A farm's name and its owner's phone (null when
/// none is on record). OwnerAccountId is for server use (plans); the contacts route does not send it.
/// </summary>
public sealed record FarmContactDto(Guid FarmId, string Name, string? OwnerPhone, Guid OwnerAccountId);
