using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

public interface IAdminMisRepository
{
    // Confirmed farm-days are no longer read here: the nightly view mis.wvfd_weekly left the read path in plan
    // CR-2e, Task 6 (C32); the route counts live through IConfirmedFarmDaysReader and ConfirmedFarmDays.

    // Phase 4 — Farms. adminUserId is named in the cross-farm audit row (spec company-mis-real-numbers-2026-11-15).
    // Checked days, self-only days and the tier come from ConfirmedFarmDays for the farms on the page, read with the
    // keys of this same audited open (C32); a farm that cannot be read is marked not measured on its row (C33). The
    // tier filter counts every farm before paging; above the live-count ceiling, or when a farm cannot be read, the
    // answer carries FarmsListDto.RefusalCode instead of a list.
    Task<FarmsListDto> GetFarmsListAsync(
        Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default);

    // The nightly view's watchlist (mis.silent_churn_watchlist) is no longer read here: it left the read path in plan
    // CR-2e, Task 4 (C26) and its method left in the CR-2d clean-up (C27(6)); the silent-farms route counts live
    // through GetSilentChurnHandler.

    /// <summary>
    /// Farms with three or more problems in the last 7 days, by the one farm rule and the one problem rule
    /// (plan CR-2e, Task 2). At most 50, by count then latest. Reads analytics.events only; a failure escapes.
    /// </summary>
    Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default);

    /// <summary>
    /// The name, owner phone and owner account of each of these farms (plan CR-2e, Task 1). A farm that does not
    /// exist is left out. A cross-farm read: it opens the admin factory once, which writes one
    /// <c>admin_cross_tenant</c> audit row naming <paramref name="adminUserId"/>; with no ids it opens nothing.
    /// A factory that can see no farm at all throws, never answers an empty list.
    /// </summary>
    Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
        Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    // Phase 5 — Users
    Task<UsersListDto> GetUsersListAsync(
        int page, int pageSize, string? search, CancellationToken ct = default);
}
