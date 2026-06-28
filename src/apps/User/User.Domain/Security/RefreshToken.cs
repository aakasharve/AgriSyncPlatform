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

    public bool IsExpired(DateTime utcNow) => utcNow >= ExpiresAtUtc;
    public bool IsRevoked => RevokedAtUtc is not null;
    public bool IsActive(DateTime utcNow) => !IsRevoked && !IsExpired(utcNow);

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
