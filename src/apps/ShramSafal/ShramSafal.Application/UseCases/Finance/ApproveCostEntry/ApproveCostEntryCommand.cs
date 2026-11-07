namespace ShramSafal.Application.UseCases.Finance.ApproveCostEntry;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12). A reviewer's मंजूर on one bill, from the
/// sync push (<c>approve_cost_entry</c>) or the REST door (<c>POST /shramsafal/finance/cost-entry/{id}/approve</c>): ONE
/// handler for both.
/// </summary>
/// <param name="CostEntryId">The bill.</param>
/// <param name="FarmId">The farm the phone says the bill is on (the push names it; the REST door does not: null).</param>
/// <param name="BillVersion">The version of the bill he SAW. A version that moved on is refused (the L4b exact-version code).</param>
/// <param name="ApprovedByUserId">The authenticated sender — never a payload field.</param>
/// <param name="ApprovalId">The stamp's own id, made on the phone (null on the REST door: the server makes one).</param>
public sealed record ApproveCostEntryCommand(
    Guid CostEntryId,
    Guid? FarmId,
    int BillVersion,
    Guid ApprovedByUserId,
    Guid? ApprovalId = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
