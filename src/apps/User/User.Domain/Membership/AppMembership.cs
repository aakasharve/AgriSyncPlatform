using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Domain.Membership;

public sealed class AppMembership : Entity<Guid>
{
    private AppMembership() : base(Guid.Empty) { } // EF Core

    public AppMembership(Guid id, UserId userId, string appId, AppRole role, DateTime grantedAtUtc)
        : base(id)
    {
        UserId = userId;
        AppId = appId;
        Role = role;
        GrantedAtUtc = grantedAtUtc;
    }

    public UserId UserId { get; private set; }
    public string AppId { get; private set; } = string.Empty;
    public AppRole Role { get; private set; }
    public DateTime GrantedAtUtc { get; private set; }
    public bool IsRevoked { get; private set; }

    public void ChangeRole(AppRole newRole, DateTime utcNow)
    {
        Role = newRole;
        GrantedAtUtc = utcNow;
    }

    public void Revoke()
    {
        IsRevoked = true;
    }
}
