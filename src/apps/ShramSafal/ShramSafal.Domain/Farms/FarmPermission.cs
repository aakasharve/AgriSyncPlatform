namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — what the OWNER switched on for one person on
/// one farm, beside their role (PLR-D7 §2: role · scope · permissions). Stored as a nullable
/// bitmask on <c>ssf.farm_memberships.permissions</c>: <c>null</c> = the role's defaults
/// (<see cref="FarmPermissionDefaults"/>), so every row written before step 2 keeps answering
/// exactly what its role answers (doctrine P11).
///
/// <para><b>Values are persisted — never renumber.</b> Add a new flag on a new bit only.</para>
///
/// <para><b>Not here, on purpose:</b> the labour-record grant ("हजेरी व पक्कं करणे",
/// <see cref="FarmMembership.CanManageLabourRecords"/>). It stays the ONE owner switch it already
/// is (founder D5, 2026-09-02) — duplicating it as a flag would give the owner two switches for one
/// power, which is how they drift apart.</para>
///
/// <para><b>Which flags the server ENFORCES in step 2:</b> only <see cref="AddCost"/>, and only on
/// CHANGING money — correcting a cost and allocating a whole-farm cost. RECORDING a purchase stays
/// open to every Active member (founder D-24d / D-12; M-5 of the 27 Oct alignment).
/// <b>Despite its name (kept: it is the plan's and the spec's word, and the wire name), AddCost
/// means "may change money already recorded"</b>, and both gates read it the same way: without
/// the bit, refused. Correcting a cost keeps, in addition, its older floor (owner tier, the rule
/// before step 2), so a bit stored for a worker or मुकादम lets him split a whole-farm bill but
/// not correct one. No phone switch stores the bit in step 2 (only the primary owner holds it);
/// the phone hides the bill-split step from a seat whose <c>/me/context</c> permissions lack it.
/// <see cref="PlanWork"/> means D-24 "plan and assign tasks" and is enforced by nothing until the
/// planned-work store exists (the crop-schedule edits keep their own rule, role >= Mukadam: the
/// schedule ↔ planning integration is on hold, D-24e2). The others are recorded for the steps that
/// enforce them (SeeMoney / SeeWages: the role-scoped download, step 4). None of them is offered to
/// the owner as a switch before its step (P5, plan §4).</para>
/// </summary>
[Flags]
public enum FarmPermission
{
    None = 0,
    SeeMoney = 1 << 0,
    SeeWages = 1 << 1,
    AddCost = 1 << 2,
    PlanWork = 1 << 3,
    Invite = 1 << 4,
    AddTestRecord = 1 << 5,
}
