using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Domain.Security;

public sealed class RefreshToken : Entity<Guid>
{
    private RefreshToken() : base(Guid.Empty) { }

    public RefreshToken(
        Guid id,
        UserId userId,
        string tokenHash,
        string deviceId,
        string? deviceName,
        string platform,
        DateTime createdAtUtc,
        DateTime expiresAtUtc)
        : base(id)
    {
        UserId = userId;
        TokenHash = tokenHash;
        DeviceId = deviceId;
        DeviceName = string.IsNullOrWhiteSpace(deviceName) ? null : deviceName.Trim();
        Platform = string.IsNullOrWhiteSpace(platform) ? "unknown" : platform.Trim();
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = expiresAtUtc;
        LastUsedAtUtc = createdAtUtc;
    }

    public UserId UserId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public string DeviceId { get; private set; } = string.Empty;
    public string? DeviceName { get; private set; }
    public string Platform { get; private set; } = "unknown";
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public DateTime LastUsedAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }
    public string? RevocationReason { get; private set; }
    public Guid? ReplacedByTokenId { get; private set; }

    /// <summary>
    /// spec: plr-d10 lane NP-1 — the new-phone question for this session; <c>null</c> = not held (the
    /// phone is known for the account). A known phone is a <see cref="DeviceId"/> with such a row.
    /// </summary>
    public DeviceCheckState? DeviceCheck { get; private set; }

    /// <summary>When the person answered the question on this session (होय or नाही).</summary>
    public DateTime? DeviceCheckAnsweredAtUtc { get; private set; }

    public bool IsExpired(DateTime utcNow) => utcNow >= ExpiresAtUtc;
    public bool IsRevoked => RevokedAtUtc is not null;
    public bool IsActive(DateTime utcNow) => !IsRevoked && !IsExpired(utcNow);

    /// <summary>True while the phone has not answered: nothing of the account is served to it.</summary>
    public bool IsHeldForDeviceCheck =>
        DeviceCheck is DeviceCheckState.AskedAfterSmsCode or DeviceCheckState.AskedAfterPassword;

    /// <summary>Holds a NEW session until its phone answers; <paramref name="hold"/> must be one of the two asked states.</summary>
    public void HoldForDeviceCheck(DeviceCheckState hold)
    {
        if (hold is not (DeviceCheckState.AskedAfterSmsCode or DeviceCheckState.AskedAfterPassword))
        {
            throw new ArgumentOutOfRangeException(nameof(hold), hold, "A session can only be held as asked.");
        }

        DeviceCheck = hold;
    }

    /// <summary>"होय": this phone becomes known for the account; the session is no longer held.</summary>
    public void ConfirmDevice(DateTime utcNow)
    {
        if (!IsHeldForDeviceCheck)
        {
            throw new InvalidOperationException("Only a held session can be confirmed.");
        }

        DeviceCheck = null;
        DeviceCheckAnsweredAtUtc = utcNow;
    }

    /// <summary>"नाही": the session ends now and stays as the support mark (D-85).</summary>
    public void DeclineDevice(DateTime utcNow)
    {
        if (!IsHeldForDeviceCheck)
        {
            throw new InvalidOperationException("Only a held session can be declined.");
        }

        DeviceCheck = DeviceCheckState.Declined;
        DeviceCheckAnsweredAtUtc = utcNow;
        if (!IsRevoked)
        {
            Revoke(utcNow, "device_check_declined");
        }
    }

    public void MarkUsed(DateTime utcNow) => LastUsedAtUtc = utcNow;

    public void MarkRotated(DateTime utcNow, Guid replacementTokenId)
    {
        RevokedAtUtc = utcNow;
        RevocationReason = "rotated";
        ReplacedByTokenId = replacementTokenId;
    }

    public void Revoke(DateTime utcNow, string reason = "revoked")
    {
        RevokedAtUtc = utcNow;
        RevocationReason = reason;
    }
}
