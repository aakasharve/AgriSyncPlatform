using ShramSafal.Application.Ports;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1b (founder D-105 (b), answered 2026-11-08: "Only you, the main
/// owner, can change an approved bill's price. The bill then shows 'changed by owner' to everyone, you included.").
///
/// <para>The mark "मालकाने बदलला" / "Changed by owner": a bill that carries a मंजूर stamp and whose price was changed AFTER its
/// first stamp. It needs no stored flag and no new column: since this lane, every door that changes a bill's price
/// (<c>CorrectCostEntryHandler</c> — REST and the sync push — and a record edit's money, <c>EditMoney</c>) refuses everyone but
/// the farm's primary account holder once a stamp exists (<see cref="UseCases.Finance.ApproveCostEntry.BillApprovalRules"/>), and the
/// stamp and the correction are decided under the same row hold on the bill, so a correction dated after the first stamp is the
/// owner's by construction. The mark is therefore READ from the append-only rows (stamps and corrections), never typed or sent
/// by a phone, and it is kept for ever — a later stamp on the new version does not hide it (the bill's history never lies).
/// A correction before the first stamp is an ordinary correction: no mark.</para>
///
/// <para>The date is the moment of his LATEST such change.</para>
/// </summary>
public static class BillOwnerChange
{
    /// <summary>
    /// Pure rule. <paramref name="approvals"/> and <paramref name="corrections"/> may hold other bills' rows; only each bill's own
    /// (and, for stamps, its own farm's: E4) are used.
    /// </summary>
    /// <returns>For each bill with such a change, the moment of the latest one.</returns>
    public static IReadOnlyDictionary<Guid, DateTime> Of(
        IEnumerable<CostEntry> entries,
        IEnumerable<CostEntryApproval> approvals,
        IEnumerable<FinanceCorrection> corrections)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(approvals);
        ArgumentNullException.ThrowIfNull(corrections);

        var firstStamp = new Dictionary<Guid, DateTime>();
        var bills = entries.ToDictionary(e => e.Id);
        foreach (var stamp in approvals)
        {
            if (!bills.TryGetValue(stamp.CostEntryId, out var bill) || bill.FarmId != stamp.FarmId)
            {
                continue;
            }

            if (!firstStamp.TryGetValue(stamp.CostEntryId, out var seen) || stamp.ApprovedAtUtc < seen)
            {
                firstStamp[stamp.CostEntryId] = stamp.ApprovedAtUtc;
            }
        }

        var changed = new Dictionary<Guid, DateTime>();
        foreach (var correction in corrections)
        {
            if (!firstStamp.TryGetValue(correction.CostEntryId, out var approvedAt) || correction.CorrectedAtUtc <= approvedAt)
            {
                continue;
            }

            if (!changed.TryGetValue(correction.CostEntryId, out var latest) || correction.CorrectedAtUtc > latest)
            {
                changed[correction.CostEntryId] = correction.CorrectedAtUtc;
            }
        }

        return changed;
    }

    /// <summary>
    /// The same for the bills a response carries: corrections are read ONLY for bills that have a stamp (most bills have none, so
    /// most responses read nothing here). A failed read fails the response, like the stamps' own read.
    /// </summary>
    public static async Task<IReadOnlyDictionary<Guid, DateTime>> OfAsync(
        IShramSafalRepository repository,
        IReadOnlyCollection<CostEntry> entries,
        IReadOnlyCollection<CostEntryApproval> approvals,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(approvals);

        if (approvals.Count == 0)
        {
            return new Dictionary<Guid, DateTime>();
        }

        var stamped = approvals.Select(a => a.CostEntryId).ToHashSet();
        var ids = entries.Where(e => stamped.Contains(e.Id)).Select(e => e.Id).ToList();
        if (ids.Count == 0)
        {
            return new Dictionary<Guid, DateTime>();
        }

        var corrections = await repository.GetCorrectionsForEntriesAsync(ids, ct);
        return Of(entries, approvals, corrections);
    }
}
