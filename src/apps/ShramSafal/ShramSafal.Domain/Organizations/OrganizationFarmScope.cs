using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Organizations;

public sealed class OrganizationFarmScope : Entity<Guid>
{
    private OrganizationFarmScope() : base(Guid.Empty) { }

    private OrganizationFarmScope(
        Guid id,
        Guid organizationId,
        FarmId farmId,
        FarmScopeSource source,
        UserId grantedByUserId,
        DateTime grantedAtUtc) : base(id)
    {
        OrganizationId = organizationId;
        FarmId = farmId;
        Source = source;
        GrantedByUserId = grantedByUserId;
        GrantedAtUtc = grantedAtUtc;
        IsActive = true;
    }

    public Guid OrganizationId { get; private set; }
    public FarmId FarmId { get; private set; }
    public FarmScopeSource Source { get; private set; }
    public UserId GrantedByUserId { get; private set; }
    public DateTime GrantedAtUtc { get; private set; }
    public bool IsActive { get; private set; }

    public static OrganizationFarmScope Grant(
        Guid id,
        Guid organizationId,
        FarmId farmId,
        FarmScopeSource source,
        UserId grantedByUserId,
        DateTime grantedAtUtc)
    {
        if (source == FarmScopeSource.PlatformWildcard)
            throw new InvalidOperationException(
                "Use GrantPlatformWildcard for PlatformWildcard source.");

        var s = new OrganizationFarmScope(id, organizationId, farmId, source, grantedByUserId, grantedAtUtc);
        s.Raise(new OrganizationFarmScopeGrantedEvent(
            Guid.NewGuid(), grantedAtUtc, id, organizationId, farmId, source, grantedByUserId));
        return s;
    }

    public static OrganizationFarmScope GrantPlatformWildcard(
        Guid id,
        Guid organizationId,
        UserId grantedByUserId,
        DateTime grantedAtUtc)
    {
        var wildcardFarmId = new FarmId(Guid.Empty);
        var s = new OrganizationFarmScope(
            id, organizationId, wildcardFarmId,
            FarmScopeSource.PlatformWildcard, grantedByUserId, grantedAtUtc);
        s.Raise(new OrganizationFarmScopeGrantedEvent(
            Guid.NewGuid(), grantedAtUtc, id, organizationId, wildcardFarmId,
            FarmScopeSource.PlatformWildcard, grantedByUserId));
        return s;
    }

    public void Revoke(UserId revokedByUserId, DateTime occurredAtUtc)
    {
        if (!IsActive) return;
        IsActive = false;
        Raise(new OrganizationFarmScopeRevokedEvent(
            Guid.NewGuid(), occurredAtUtc, Id, OrganizationId, FarmId, revokedByUserId));
    }
}
