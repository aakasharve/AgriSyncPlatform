using ShramSafal.Application.Ports;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25, lane MU-1 fix round 1 (founder D-70 option 2, register F124; review
/// HIGH-1) - a crew's total day wage is stored twice: as the labour line's <c>totalCost</c> on the record and as a money
/// entry of category <c>labour_misc</c> ("generic voice / manual labour spend", RecordFirstMoney). A person who covers only
/// chosen plots and holds see wages (<see cref="FarmReadScope.DayWagesRuledOut"/>) must not read the second any more than the
/// first: the headcount stays visible, so total / headcount would give the day wage. This is the ONE rule every money reader
/// asks: the sync pull, the labour page's tile and totals, the finance summaries and ledger shares, the duplicate check.
/// Job-card money (<c>labour_payout</c>), every other category, the owner and any other seat are untouched; a money entry the
/// reader made himself is his own statement and stays (MU-4 M5, D-28).
/// </summary>
public static class DayWageMoney
{
    /// <summary>The category a recorded crew's total is stored under (the day-wage money entry).</summary>
    public const string CategoryId = "labour_misc";

    /// <summary>Is <paramref name="entry"/> kept from this reader because it is a day wage and he sees none?</summary>
    public static bool HiddenFrom(FarmReadScope? scope, CostEntry entry, Guid readerUserId)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return scope is { DayWagesRuledOut: true }
            && string.Equals(entry.CategoryId, CategoryId, StringComparison.Ordinal)
            && entry.CreatedByUserId.Value != readerUserId;
    }

    /// <summary>
    /// The ids, among <paramref name="sourceCostEntryIds"/> (the money entries day-ledger rows were split from), of the
    /// entries kept from this reader - so a share line of a split day wage goes with it. One read, and only when the scope
    /// rules day wages out and there is something to ask about.
    /// </summary>
    public static async Task<HashSet<Guid>> HiddenSourcesAsync(
        IShramSafalRepository repository,
        FarmReadScope? scope,
        Guid readerUserId,
        IEnumerable<Guid> sourceCostEntryIds,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        var ids = sourceCostEntryIds.Distinct().ToList();
        if (scope is not { DayWagesRuledOut: true } || ids.Count == 0)
        {
            return [];
        }

        return (await repository.GetCostEntriesByIdsAsync(ids, ct))
            .Where(entry => HiddenFrom(scope, entry, readerUserId))
            .Select(entry => entry.Id)
            .ToHashSet();
    }
}
