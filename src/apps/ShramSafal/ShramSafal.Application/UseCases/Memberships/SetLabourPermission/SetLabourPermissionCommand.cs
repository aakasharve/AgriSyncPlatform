using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Memberships.SetLabourPermission;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — an owner grants or withdraws labour-record
/// management for ONE member of ONE farm (founder decision O-4).
///
/// <para><b>Absolute state, not a toggle verb.</b> The command carries the value
/// the owner wants (<c>true</c>/<c>false</c>), never "flip it". A farmer on a
/// rural connection re-sending the same request must land on the same state, and
/// two devices sending "flip" would race into opposite answers. This is what
/// makes the endpoint naturally idempotent without an
/// <c>Idempotency-Key</c>.</para>
///
/// <para><b><see cref="TargetUserId"/> is the member's user id, not a membership
/// id.</b> The owner's UI knows people, not membership rows, and the membership
/// row for a (farm, user) pair is unique among non-terminal statuses
/// (<c>ix_farm_memberships_farm_user_nonterminal</c>).</para>
/// </summary>
/// <param name="FarmId">The farm whose access is being managed.</param>
/// <param name="TargetUserId">The member receiving or losing the capability.</param>
/// <param name="CanManageLabourRecords">The state the owner is asking for.</param>
/// <param name="CallerUserId">
/// The acting owner. Never taken from the body — the endpoint reads it from the
/// validated JWT subject.
/// </param>
/// <param name="ClientAppVersion">Forensic provenance for the AuditEvent row.</param>
/// <param name="AuditDeviceId">Forensic provenance for the AuditEvent row.</param>
/// <param name="AuditIpHash">Forensic provenance for the AuditEvent row.</param>
public sealed record SetLabourPermissionCommand(
    FarmId FarmId,
    UserId TargetUserId,
    bool CanManageLabourRecords,
    UserId CallerUserId,
    string ClientAppVersion,
    string AuditDeviceId,
    string AuditIpHash);
