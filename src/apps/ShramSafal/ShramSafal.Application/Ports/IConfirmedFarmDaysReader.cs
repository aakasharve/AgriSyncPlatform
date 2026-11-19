using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32; C12). Hands over the raw rows
/// confirmed farm-days are counted from: each farm's entries in a window and the verification events on them. Every
/// counting rule lives in <c>ConfirmedFarmDays</c>; the reader decides nothing and catches nothing (a failed read
/// escapes and the route answers 500, never an empty or zero answer).
/// <list type="number">
/// <item>Every farm row is read as the app login on the SCOPED context, one farm per transaction, inside
/// <c>RlsIdentityScope.RunAsFarmAsync</c>, so row-level security decides what is seen. A key whose owner account is
/// empty, or whose farm row does not come back under its own scope, is counted as not readable.</item>
/// <item>Above the live-count ceiling (<c>GetCompanyMisHandler.MaxFarmsForLiveCount</c>, amendment A1) no farm row is
/// read and <see cref="ConfirmedFarmDaysRows.LiveCountSkipped"/> is true.</item>
/// <item>Entries are those created at or after <c>sinceUtc</c> and strictly before <c>countedAtUtc</c>; events are
/// every event on those entries that occurred strictly before <c>countedAtUtc</c> (no lower bound, as the old
/// view).</item>
/// </list>
/// </summary>
public interface IConfirmedFarmDaysReader
{
    /// <summary>
    /// Lists every farm key (id, owner account) ONCE through the audited cross-farm factory (one
    /// <c>admin_cross_tenant</c> audit row naming <paramref name="adminUserId"/>), then reads each farm as
    /// <see cref="ReadFarmsAsync"/> does. For the confirmed farm-days route.
    /// </summary>
    Task<ConfirmedFarmDaysRows> ReadAllAsync(
        Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct = default);

    /// <summary>
    /// Reads these farms only. Opens no factory: the caller passes keys it read through its own audited open
    /// (All Farms, C32: one open per request).
    /// </summary>
    Task<ConfirmedFarmDaysRows> ReadFarmsAsync(
        IReadOnlyCollection<ConfirmedFarmKey> keys, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct = default);
}

/// <summary>A farm and the owner account its row-level security keys on.</summary>
public sealed record ConfirmedFarmKey(Guid FarmId, Guid OwnerAccountId);

/// <summary>
/// The row bundle. <see cref="FarmsListed"/> is the number of keys asked for; <see cref="FarmsNotReadable"/> the keys
/// with no owner account or whose farm row did not come back under row-level security. When
/// <see cref="LiveCountSkipped"/> is true no farm row was read.
/// </summary>
public sealed record ConfirmedFarmDaysRows(
    int FarmsListed,
    int FarmsNotReadable,
    IReadOnlyList<ConfirmedFarmRow> Farms,
    IReadOnlyList<ConfirmedEntryRow> Entries,
    IReadOnlyList<ConfirmedCheckRow> Checks,
    bool LiveCountSkipped);

/// <summary>A readable farm and its owner (farms owned by a test account are left out by the rule).</summary>
public sealed record ConfirmedFarmRow(Guid FarmId, Guid OwnerUserId);

/// <summary>One <c>ssf.daily_logs</c> row. CreatedAtUtc is server arrival time; OperatorUserId the person who saved it.</summary>
public sealed record ConfirmedEntryRow(Guid EntryId, Guid FarmId, Guid OperatorUserId, DateTime CreatedAtUtc);

/// <summary>One <c>ssf.verification_events</c> row on a loaded entry.</summary>
public sealed record ConfirmedCheckRow(
    Guid EntryId, VerificationStatus Status, string? Reason, Guid VerifiedByUserId, DateTime OccurredAtUtc);
