using ShramSafal.Application.Admin;

namespace ShramSafal.Application.UseCases.Admin.GetFarmerHealth;

/// <summary>
/// Query for the one-farm page (<c>GET /admin/farmer-health/{farmId}</c>).
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.6 Step 1. <see cref="Scope"/> is the first parameter per the
/// <c>admin-scope-guard</c> CI gate (plan §1.5.4 #18) — every admin-side
/// query record must take an <see cref="AdminScope"/> first so the gate
/// can verify it via syntactic inspection.
/// </para>
/// <para>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3, C21). <see cref="ActorUserId"/> is the signed-in
/// admin; the audited cross-farm factory records it on the one audit row the page writes.
/// </para>
/// <para>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4). The page's phone follows the scope it carries
/// (<see cref="ControlRoomPhones.MayRead"/>); <see cref="AuditDeviceId"/> and <see cref="AuditIpHash"/> are written
/// on the History row of a phone look.
/// </para>
/// </remarks>
public sealed record GetFarmerHealthQuery(
    AdminScope Scope, Guid FarmId, Guid ActorUserId, string AuditDeviceId, string AuditIpHash);
