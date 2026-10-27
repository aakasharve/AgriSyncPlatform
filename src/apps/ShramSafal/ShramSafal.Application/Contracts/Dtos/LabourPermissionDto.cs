namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — one member's labour-record authority on one farm, as
/// the farm access-management surface needs to RENDER it (founder decision O-4).
///
/// <para><b>Why <see cref="Source"/> exists and why the UI must honour it.</b>
/// An owner-tier member is allowed <i>by role</i> (D5, 2026-09-02: owner-tier
/// ONLY — a Mukadam no longer is); their stored grant flag is <c>false</c> and
/// switching it has no effect. A toggle rendered as interactive for those
/// members would be a control that looks functional and does nothing (doctrine
/// P5) — the same defect the existing <c>TeamMemberCard</c> toggles have today
/// by being local state that reaches no server. So the read tells the client
/// WHICH reason applies, and <see cref="IsGrantEditable"/> says plainly whether
/// the switch may be interactive at all. The write endpoint independently
/// REFUSES a request that would toggle a role-carried capability, so a client
/// that ignores this cannot fake it either.</para>
/// </summary>
/// <param name="UserId">The member.</param>
/// <param name="Role">
/// The member's <c>AppRole</c> on this farm, as its enum NAME
/// ("PrimaryOwner"/"Mukadam"/"Worker"/...), never its ordinal — an ordinal
/// silently re-maps the day a member is inserted into the enum.
/// </param>
/// <param name="Status">
/// The membership status name ("Active"/"Suspended"/"PendingApproval"/...).
/// Non-terminal rows only are returned; the status is exposed so an owner can
/// see they are granting to someone not yet active.
/// </param>
/// <param name="CanManageLabourRecords">
/// The EFFECTIVE answer: may this member correct labour, manage field-operator
/// identity, change attribution, approve/verify, and correct duration. This is
/// the field a client should render as "can do it", never
/// <see cref="HasExplicitGrant"/>.
/// </param>
/// <param name="HasExplicitGrant">
/// The stored <c>can_manage_labour_records</c> column — the owner's explicit
/// decision. Always <c>false</c> for roles that carry the capability anyway.
/// </param>
/// <param name="Source">
/// Why: <c>"OwnerTier"</c> · <c>"ExplicitGrant"</c> · <c>"NotGranted"</c>.
/// (<c>"MukadamDefault"</c> was deleted 2026-09-02 — D5 removed the role carry.)
/// </param>
/// <param name="IsGrantEditable">
/// <c>false</c> for owner-tier — the switch renders permanently on and
/// non-interactive. <c>true</c> for every other role, a Mukadam included.
/// </param>
/// <param name="LabourGrantExpiresAtUtc">
/// The instant the responsibility ends, <c>null</c> for कायम — and <c>null</c>
/// once lapsed: an expired grant reports as NotGranted with no ghost date.
/// </param>
/// <param name="DisplayName">
/// The member's name from the user directory, so the owner's Team page can list
/// and label a member the sync pull never sent (its operator role comes from a
/// table whose RLS hides every other member). Present ONLY on the owner-tier
/// roster read - this route is owner/co-owner-only - and <c>null</c> on the
/// grant-write response and whenever the directory has no name; the client must
/// then show NO name rather than invent one. Additive: older clients ignore it.
/// </param>
/// <param name="Permissions">
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE: the member's EFFECTIVE permission
/// names (<c>FarmPermission</c>: "AddCost", "PlanWork", ...) — role defaults merged with the owner's
/// stored choice, and empty for a seat that is not Active. <c>null</c> only from an older server.
/// </param>
/// <param name="StatusReason">
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE: the owner's written reason for the
/// last decision (a pause, a removal, a decline), or <c>null</c>.
/// </param>
/// <param name="IsRegistrant">
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE: this member registered the farm
/// (<c>farms.owner_user_id</c>). Nobody may pause, remove or change him (plan §4), so the phone
/// shows no such control on his card.
/// </param>
/// <param name="JoinedVia">
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE: how the seat came to be
/// ("SelfJoin" = typed the farm code, "QrScan", ...). Audit wording only, never authority.
/// </param>
/// <param name="RequestedAtUtc">
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE: when the seat was made (for a waiting
/// request: when the person asked).
/// </param>
/// <param name="PhoneLast4">
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, M-7) — ADDITIVE: the last four digits of the
/// member's account phone, so the owner sees who is really asking (names are self-typed). Only on
/// the owner-tier roster and the owner's decision answer; <c>null</c> when unknown — the phone then
/// shows nothing.
/// </param>
/// <param name="ApprovedByOwner">
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, M-8) — ADDITIVE: an owner approved this seat (it
/// came in by asking — the typed farm code, or a farm-QR scan after the owner had stopped the
/// person), as opposed to a direct farm-QR join. Wording only, never authority.
/// </param>
public sealed record LabourPermissionDto(
    Guid UserId,
    string Role,
    string Status,
    bool CanManageLabourRecords,
    bool HasExplicitGrant,
    string Source,
    bool IsGrantEditable,
    DateTime? LabourGrantExpiresAtUtc,
    string? DisplayName = null,
    IReadOnlyList<string>? Permissions = null,
    string? StatusReason = null,
    bool IsRegistrant = false,
    string? JoinedVia = null,
    DateTime? RequestedAtUtc = null,
    string? PhoneLast4 = null,
    bool ApprovedByOwner = false);
