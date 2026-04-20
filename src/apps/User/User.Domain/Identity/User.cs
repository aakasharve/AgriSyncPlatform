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

    private User(
        UserId id,
        PhoneNumber phone,
        string displayName,
        Credential credential,
        DateTime createdAtUtc,
        AuthMode authMode,
        DateTime? phoneVerifiedAtUtc,
        string preferredLanguage)
        : base(id)
    {
        Phone = phone;
        DisplayName = displayName;
        Credential = credential;
        CreatedAtUtc = createdAtUtc;
        IsActive = true;
        AuthMode = authMode;
        PhoneVerifiedAtUtc = phoneVerifiedAtUtc;
        PreferredLanguage = preferredLanguage;
    }

    public PhoneNumber Phone { get; private set; } = null!;
    public string DisplayName { get; private set; } = string.Empty;
    public Credential Credential { get; private set; } = null!;
    public DateTime CreatedAtUtc { get; private set; }
    public bool IsActive { get; private set; }

    /// <summary>
    /// When the phone was last OTP-verified. <c>null</c> for password-only
    /// users who never went through OTP. The semi-literate UI uses this to
    /// decide whether to show the "verify phone" banner.
    /// </summary>
    public DateTime? PhoneVerifiedAtUtc { get; private set; }

    /// <summary>
    /// ISO language code — <c>"mr"</c> (default), <c>"hi"</c>, or <c>"en"</c>.
    /// Used by the frontend to load Marathi before any English flash.
    /// </summary>
    public string PreferredLanguage { get; private set; } = "mr";

    /// <summary>
    /// Primary authentication method. The frontend hides the password box
    /// for <see cref="AuthMode.Otp"/> users.
    /// </summary>
    public AuthMode AuthMode { get; private set; }

    public IReadOnlyCollection<AppMembership> Memberships => _memberships.AsReadOnly();

    public static User Register(
        UserId id,
        PhoneNumber phone,
        string displayName,
        string passwordHash,
        DateTime utcNow)
    {
        var credential = Credential.Create(passwordHash, utcNow);
        var user = new User(
            id,
            phone,
            displayName,
            credential,
            utcNow,
            authMode: AuthMode.Password,
            phoneVerifiedAtUtc: null,
            preferredLanguage: "mr");

        user.Raise(new UserRegisteredEvent(Guid.NewGuid(), utcNow, id, phone.Value, displayName));

        return user;
    }

    /// <summary>
    /// Register a user through the OTP path. The stored credential is an
    /// opaque unusable-hash marker (no password works against it); the
    /// user authenticates exclusively via phone OTP until they explicitly
    /// set a password later. Phone is considered verified at registration
    /// because OTP registration only completes after a valid code.
    /// </summary>
    public static User RegisterViaOtp(
        UserId id,
        PhoneNumber phone,
        string displayName,
        string unusablePasswordHash,
        DateTime utcNow)
    {
        var credential = Credential.Create(unusablePasswordHash, utcNow);
        var user = new User(
            id,
            phone,
            displayName,
            credential,
            utcNow,
            authMode: AuthMode.Otp,
            phoneVerifiedAtUtc: utcNow,
            preferredLanguage: "mr");
        user.Raise(new UserRegisteredEvent(Guid.NewGuid(), utcNow, id, phone.Value, displayName));
        return user;
    }

    /// <summary>
    /// Marks the phone as OTP-verified. Idempotent — repeated calls update
    /// the timestamp but never clear it. Called by <c>VerifyOtpHandler</c>
    /// when an existing user completes an OTP login.
    /// </summary>
    public void MarkPhoneVerified(DateTime utcNow)
    {
        PhoneVerifiedAtUtc = utcNow;
    }

    /// <summary>
    /// Updates the preferred language. Accepts <c>"mr"</c>, <c>"hi"</c>, or
    /// <c>"en"</c>; anything else falls back to <c>"mr"</c>.
    /// </summary>
    public void SetPreferredLanguage(string language)
    {
        PreferredLanguage = language switch
        {
            "mr" or "hi" or "en" => language,
            _ => "mr",
        };
    }

    [Obsolete("AppMembership is deprecated (spec §3.2). Use FarmMembership (ShramSafal.Domain) for authorization.")]
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
