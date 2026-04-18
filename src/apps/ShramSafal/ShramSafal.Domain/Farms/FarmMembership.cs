using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Farms;

public sealed class FarmMembership : Entity<Guid>
{
    private FarmMembership() : base(Guid.Empty) { } // EF Core

    private FarmMembership(
        Guid id,
        FarmId farmId,
        UserId userId,
        AppRole role,
        DateTime grantedAtUtc)
        : base(id)
    {
        FarmId = farmId;
        UserId = userId;
        Role = role;
        GrantedAtUtc = grantedAtUtc;
        ModifiedAtUtc = grantedAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public UserId UserId { get; private set; }
    public AppRole Role { get; private set; }
    public DateTime GrantedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public bool IsRevoked { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }

    public static FarmMembership Create(
        Guid id,
        FarmId farmId,
        UserId userId,
        AppRole role,
        DateTime grantedAtUtc)
    {
        if (farmId.IsEmpty)
        {
            throw new ArgumentException("Farm id is required.", nameof(farmId));
        }

        if (userId.IsEmpty)
        {
            throw new ArgumentException("User id is required.", nameof(userId));
        }

        return new FarmMembership(id, farmId, userId, role, grantedAtUtc);
    }

    public void ChangeRole(AppRole newRole, DateTime utcNow)
    {
        Role = newRole;
        ModifiedAtUtc = utcNow;
    }

    public void Revoke(DateTime utcNow)
    {
        IsRevoked = true;
        RevokedAtUtc = utcNow;
        ModifiedAtUtc = utcNow;
    }
}
