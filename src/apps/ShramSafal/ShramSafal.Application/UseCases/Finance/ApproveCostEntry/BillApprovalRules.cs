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
}
