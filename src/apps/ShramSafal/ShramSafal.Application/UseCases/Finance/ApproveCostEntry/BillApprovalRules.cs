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
}
