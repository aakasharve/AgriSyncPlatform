using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using User.Domain.Events;
using User.Domain.Membership;
using User.Domain.Security;

namespace User.Domain.Identity;

public sealed class User : Entity<UserId>
{
    private readonly List<AppMembership> _memberships = [];

    private User() : base(UserId.Empty) { } // EF Core

    private User(UserId id, PhoneNumber phone, string displayName, Credential credential, DateTime createdAtUtc)
        : base(id)
    {
        Phone = phone;
        DisplayName = displayName;
        Credential = credential;
        CreatedAtUtc = createdAtUtc;
        IsActive = true;
    }

    public PhoneNumber Phone { get; private set; } = null!;
    public string DisplayName { get; private set; } = string.Empty;
    public Credential Credential { get; private set; } = null!;
    public DateTime CreatedAtUtc { get; private set; }
    public bool IsActive { get; private set; }
    public IReadOnlyCollection<AppMembership> Memberships => _memberships.AsReadOnly();

    public static User Register(
        UserId id,
        PhoneNumber phone,
        string displayName,
        string passwordHash,
        DateTime utcNow)
    {
        var credential = Credential.Create(passwordHash, utcNow);
        var user = new User(id, phone, displayName, credential, utcNow);

        user.Raise(new UserRegisteredEvent(Guid.NewGuid(), utcNow, id, phone.Value, displayName));

        return user;
    }

    /// <summary>
    /// Register a user through the OTP path. The stored credential is an
    /// opaque unusable-hash marker (no password works against it); the
    /// user authenticates exclusively via phone OTP until they explicitly
    /// set a password later.
    /// </summary>
    public static User RegisterViaOtp(
        UserId id,
        PhoneNumber phone,
        string displayName,
        string unusablePasswordHash,
        DateTime utcNow)
    {
        var credential = Credential.Create(unusablePasswordHash, utcNow);
        var user = new User(id, phone, displayName, credential, utcNow);
        user.Raise(new UserRegisteredEvent(Guid.NewGuid(), utcNow, id, phone.Value, displayName));
        return user;
    }

    public AppMembership AddMembership(Guid membershipId, string appId, AppRole role, DateTime utcNow)
    {
        if (_memberships.Any(m => m.AppId == appId && !m.IsRevoked))
        {
            throw new InvalidOperationException($"User already has active membership in app '{appId}'.");
        }

        var membership = new AppMembership(membershipId, Id, appId, role, utcNow);
        _memberships.Add(membership);

        Raise(new MembershipChangedEvent(Guid.NewGuid(), utcNow, Id, appId, role.ToString()));

        return membership;
    }

    public void ChangeRole(string appId, AppRole newRole, DateTime utcNow)
    {
        var membership = _memberships.FirstOrDefault(m => m.AppId == appId && !m.IsRevoked)
            ?? throw new InvalidOperationException($"No active membership found for app '{appId}'.");

        membership.ChangeRole(newRole, utcNow);

        Raise(new MembershipChangedEvent(Guid.NewGuid(), utcNow, Id, appId, newRole.ToString()));
    }

    public void Deactivate()
    {
        IsActive = false;
    }
}
