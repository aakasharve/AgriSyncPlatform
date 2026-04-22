using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Organizations;

public sealed class OrganizationMembership : Entity<Guid>
{
    private OrganizationMembership() : base(Guid.Empty) { }

    private OrganizationMembership(
        Guid id,
        Guid organizationId,
        UserId userId,
        OrganizationRole role,
        UserId addedByUserId,
        DateTime joinedAtUtc) : base(id)
    {
        OrganizationId = organizationId;
        UserId = userId;
        Role = role;
        AddedByUserId = addedByUserId;
        JoinedAtUtc = joinedAtUtc;
        IsActive = true;
    }

    public Guid OrganizationId { get; private set; }
    public UserId UserId { get; private set; }
    public OrganizationRole Role { get; private set; }
    public UserId AddedByUserId { get; private set; }
    public DateTime JoinedAtUtc { get; private set; }
    public bool IsActive { get; private set; }

    public static OrganizationMembership Create(
        Guid id,
        Guid organizationId,
        UserId userId,
        OrganizationRole role,
        UserId addedByUserId,
        DateTime joinedAtUtc)
    {
        var m = new OrganizationMembership(id, organizationId, userId, role, addedByUserId, joinedAtUtc);
        m.Raise(new OrganizationMemberAddedEvent(
            Guid.NewGuid(), joinedAtUtc, id, organizationId, userId, role, addedByUserId));
        return m;
    }

    public void Deactivate(UserId removedByUserId, DateTime occurredAtUtc)
    {
        if (!IsActive) return;
        IsActive = false;
        Raise(new OrganizationMemberRemovedEvent(
            Guid.NewGuid(), occurredAtUtc, Id, OrganizationId, UserId, removedByUserId));
    }
}
