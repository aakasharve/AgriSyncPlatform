using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Domain.Membership;

/// <remarks>
/// Deprecated (spec §3.2). Authorization decisions in ShramSafal now use
/// <c>FarmMembership</c> (ShramSafal.Domain). This entity is kept in place
/// for backward-compatibility — do not remove the EF table or class.
/// Do NOT use this class for any new authorization checks.
/// </remarks>
[Obsolete("Use FarmMembership (ShramSafal.Domain.Farms) for authorization; see spec §3.2")]
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
