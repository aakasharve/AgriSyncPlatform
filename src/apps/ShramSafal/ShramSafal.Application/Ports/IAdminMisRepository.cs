using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

public interface IAdminMisRepository
{
    Task<WvfdHistoryDto> GetWvfdHistoryAsync(int weeks, CancellationToken ct = default);

    // Phase 4 — Farms. adminUserId is named in the cross-farm audit row (spec company-mis-real-numbers-2026-11-15).
    Task<FarmsListDto> GetFarmsListAsync(
        Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default);
    Task<IReadOnlyList<SilentChurnItemDto>> GetSilentChurnAsync(CancellationToken ct = default);
    Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default);

    // Phase 5 — Users
    Task<UsersListDto> GetUsersListAsync(
        int page, int pageSize, string? search, CancellationToken ct = default);
}
