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

    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (G1 fix round 1, I-1). The id and name of each of these farms, and nothing
    /// else: no owner phone is loaded. For a name-only farm lookup and History's farm names. Opened like
    /// <see cref="GetFarmContactsAsync"/>: one audited cross-farm open (one <c>admin_cross_tenant</c> row naming
    /// <paramref name="adminUserId"/>), nothing opened for no ids, a farm that does not exist left out, and a factory
    /// that can see no farm at all throws.
    /// </summary>
    Task<IReadOnlyList<FarmNameDto>> GetFarmNamesAsync(
        Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (G1 fix round 1, M9). The owner's user id of each of these farms (farm id
    /// to owner user id), so the weekly trust report can leave out farms owned by a test account. Opened like
    /// <see cref="GetFarmContactsAsync"/>: one audited cross-farm open, nothing opened for no ids, a farm that does
    /// not exist left out, and a factory that can see no farm at all throws.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, Guid>> GetFarmOwnersAsync(
        Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    // Phase 5 — Users
    // spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4, K09): with matchPhone false the search matches
    // display names only, so typing a phone number finds nothing for a seat without the farmer_phones tick.
    Task<UsersListDto> GetUsersListAsync(
        int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default);
}
