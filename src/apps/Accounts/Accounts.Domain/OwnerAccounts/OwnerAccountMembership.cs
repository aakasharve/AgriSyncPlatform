using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Domain.OwnerAccounts;

public sealed class OwnerAccountMembership : Entity<OwnerAccountMembershipId>
{
    private OwnerAccountMembership() : base(default) { } // EF Core

    internal OwnerAccountMembership(
        OwnerAccountMembershipId id,
        OwnerAccountId ownerAccountId,
        UserId userId,
        OwnerAccountRole role,
        UserId? invitedByUserId,
        DateTime createdAtUtc)
        : base(id)
    {
        OwnerAccountId = ownerAccountId;
        UserId = userId;
        Role = role;
        Status = OwnerAccountMembershipStatus.Active;
        InvitedByUserId = invitedByUserId;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public OwnerAccountId OwnerAccountId { get; private set; }
    public UserId UserId { get; private set; }
    public OwnerAccountRole Role { get; private set; }
    public OwnerAccountMembershipStatus Status { get; private set; }
    public UserId? InvitedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public DateTime? EndedAtUtc { get; private set; }

    public bool IsActivePrimaryOwner =>
        Status == OwnerAccountMembershipStatus.Active && Role == OwnerAccountRole.PrimaryOwner;

    internal void Suspend(DateTime utcNow)
    {
        if (Status != OwnerAccountMembershipStatus.Active)
        {
            return;
        }

        Status = OwnerAccountMembershipStatus.Suspended;
        ModifiedAtUtc = utcNow;
    }

    internal void Restore(DateTime utcNow)
    {
        if (Status != OwnerAccountMembershipStatus.Suspended)
        {
            return;
        }

        Status = OwnerAccountMembershipStatus.Active;
        ModifiedAtUtc = utcNow;
    }

    internal void Revoke(DateTime utcNow)
    {
        if (Status == OwnerAccountMembershipStatus.Revoked)
        {
            return;
        }

        Status = OwnerAccountMembershipStatus.Revoked;
        EndedAtUtc = utcNow;
        ModifiedAtUtc = utcNow;
    }
}
