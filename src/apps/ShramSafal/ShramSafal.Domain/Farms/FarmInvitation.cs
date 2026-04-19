using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// One persistent "join my farm" invitation per farm. By design simpler
/// than the original plan §5.3 — the owner's direction was to treat the
/// QR as an onboarding artifact, not a security artifact. So:
///
///   - No TTL; an invitation stays Active until explicitly Revoked.
///   - No max-uses; the same invitation brings on any number of workers.
///   - No approval gate; claims always land on an Active membership.
///
/// The <see cref="FarmJoinToken"/> child holds the actual signed secret.
/// Rotating an invitation creates a new token; the outgoing invitation
/// moves to <see cref="InvitationStatus.Revoked"/> and its old token no
/// longer validates. This is the single lever an owner pulls if they
/// ever lose control of the shared QR.
/// </summary>
public sealed class FarmInvitation : Entity<FarmInvitationId>
{
    private FarmInvitation() : base(default) { } // EF Core

    private FarmInvitation(
        FarmInvitationId id,
        FarmId farmId,
        UserId createdByUserId,
        DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = createdAtUtc;
        Status = InvitationStatus.Active;
    }

    public FarmId FarmId { get; private set; }
    public UserId CreatedByUserId { get; private set; }
    public InvitationStatus Status { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }

    public bool IsActive => Status == InvitationStatus.Active;

    public static FarmInvitation Issue(
        FarmInvitationId id,
        FarmId farmId,
        UserId createdByUserId,
        DateTime createdAtUtc)
    {
        if (id.IsEmpty) throw new ArgumentException("Invitation id is required.", nameof(id));
        if (farmId.IsEmpty) throw new ArgumentException("Farm id is required.", nameof(farmId));
        if (createdByUserId.IsEmpty) throw new ArgumentException("Creator user id is required.", nameof(createdByUserId));

        return new FarmInvitation(id, farmId, createdByUserId, createdAtUtc);
    }

    public void Revoke(DateTime utcNow)
    {
        if (Status == InvitationStatus.Revoked) return;
        Status = InvitationStatus.Revoked;
        RevokedAtUtc = utcNow;
    }
}
