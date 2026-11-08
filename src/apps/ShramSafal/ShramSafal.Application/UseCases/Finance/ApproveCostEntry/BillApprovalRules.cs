namespace ShramSafal.Application.UseCases.Finance.ApproveCostEntry;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 fix round 1 (review M3; founder question D-105 (a), open).
/// May a reviewer (review money) approve a bill he entered himself? Today: yes, as built (the founder's 2026-08-27 rule for
/// records: a granted member's own record too), and the stamp names him. Kept behind ONE named check so the founder's answer is
/// a one-line change: set <see cref="ReviewerMayApproveOwnBill"/> to <c>false</c> and a reviewer's own bills need someone else.
/// The primary account holder's own bills are always his to approve.
/// </summary>
public static class BillApprovalRules
{
    /// <summary>D-105 (a). As built until the founder answers.</summary>
    public static readonly bool ReviewerMayApproveOwnBill = true;

    /// <summary>May this approver stamp this bill, as its maker or not?</summary>
    public static bool MayApproveOwnBill(bool isPrimaryAccountHolder, bool isMaker) =>
        !isMaker || isPrimaryAccountHolder || ReviewerMayApproveOwnBill;

    /// <summary>
    /// spec: plr-d10 lane BILL-1b — founder D-105 (b), answered 2026-11-08: "Only you, the main owner, can change an approved
    /// bill's price." Once a bill carries a मंजूर stamp (any version: the stamp rows are append-only history), a change to its
    /// price is the primary account holder's alone. Every door that changes a bill's amount asks this ONE check: the money
    /// book's correction (REST and the sync push, <c>CorrectCostEntryHandler</c>) and a record edit's money
    /// (<c>EditMoney</c>). A bill nobody approved is unchanged by this rule.
    /// </summary>
    public static bool MayChangeApprovedPrice(bool isPrimaryAccountHolder) => isPrimaryAccountHolder;

    /// <summary>The audit <c>trigger</c> of the stamp the owner's own change of an approved price makes.</summary>
    public const string OwnerChangeTrigger = "OwnerChangedApprovedPrice";

    /// <summary>
    /// spec: plr-d10 lane FIX-1 round 2 — founder, 2026-11-08: when the main owner changes the price of an already-approved bill,
    /// his change counts as approved straight away. The bill keeps the mark "मालकाने बदलला" and its history (the old stamp
    /// stays) but does not go back to "तपासायचे" for his new version. True only for the primary account holder on a bill that
    /// already carried a stamp; a bill nobody approved is unchanged by this rule, and nobody else can change an approved price
    /// at all (<see cref="MayChangeApprovedPrice"/>).
    /// </summary>
    public static bool OwnerChangeCountsAsApproval(bool billWasApproved, bool isPrimaryAccountHolder) =>
        billWasApproved && isPrimaryAccountHolder;

    /// <summary>
    /// The owner's stamp for the version his change just made - the SAME append-only stamp an approval makes (who: him, when:
    /// the moment of the change, which version: the new one - <see cref="Domain.Finance.CostEntry.Approve"/> checks and moves
    /// the bill's clock). Call it after the bill is marked corrected, so the stamp names the new version.
    /// </summary>
    public static Domain.Finance.CostEntryApproval OwnerChangeStamp(
        Domain.Finance.CostEntry entry,
        Guid approvalId,
        AgriSync.SharedKernel.Contracts.Ids.UserId owner,
        DateTime changedAtUtc,
        string? clientRequestId,
        string? appVersion) =>
        entry.Approve(approvalId, owner, entry.ContentVersion, changedAtUtc, clientRequestId, appVersion);
}
