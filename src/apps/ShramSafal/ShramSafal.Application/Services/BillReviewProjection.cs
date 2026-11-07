using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12). A bill as the pull (and the approve door)
/// sends it: its version, whether it is "तपासायचे" (<see cref="CostEntryReview.NeedsReview"/>), why, and its latest मंजूर
/// stamp. One projection for both, so the phone reads one shape.
/// </summary>
public static class BillReviewProjection
{
    /// <param name="dto">The bill as every other door already sends it.</param>
    /// <param name="entry">The bill.</param>
    /// <param name="approvals">Stamps read for this response; only this bill's, of this bill's farm, are used (E4).</param>
    /// <param name="names">Display names this reader may be sent (MU-3: an own-records seat gets no other person's name).</param>
    public static CostEntryDto WithReview(
        CostEntryDto dto,
        CostEntry entry,
        IEnumerable<CostEntryApproval> approvals,
        IReadOnlyDictionary<Guid, string> names)
    {
        ArgumentNullException.ThrowIfNull(dto);
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentNullException.ThrowIfNull(approvals);
        ArgumentNullException.ThrowIfNull(names);

        var own = approvals.Where(a => a.CostEntryId == entry.Id && a.FarmId == entry.FarmId).ToList();
        var needsReview = CostEntryReview.NeedsReview(entry, own);
        var latest = CostEntryReview.Latest(entry, own);
        return dto with
        {
            BillVersion = entry.ContentVersion,
            NeedsReview = needsReview,
            ReviewReason = needsReview ? entry.FlagReason : null,
            Approval = latest is null
                ? null
                : new CostEntryApprovalDto(
                    latest.Id,
                    latest.ApprovedByUserId.Value,
                    names.TryGetValue(latest.ApprovedByUserId.Value, out var name) ? name : null,
                    latest.ApprovedAtUtc,
                    latest.BillVersion),
        };
    }
}
