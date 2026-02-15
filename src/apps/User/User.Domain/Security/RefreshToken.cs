using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Domain.Security;

public sealed class RefreshToken : Entity<Guid>
{
    private RefreshToken() : base(Guid.Empty) { } // EF Core

    public RefreshToken(Guid id, UserId userId, string token, DateTime createdAtUtc, DateTime expiresAtUtc)
        : base(id)
    {
        UserId = userId;
        Token = token;
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = expiresAtUtc;
    }

    public UserId UserId { get; private set; }
    public string Token { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }

    public bool IsExpired(DateTime utcNow) => utcNow >= ExpiresAtUtc;
    public bool IsRevoked => RevokedAtUtc is not null;
    public bool IsActive(DateTime utcNow) => !IsRevoked && !IsExpired(utcNow);

    public void Revoke(DateTime utcNow)
    {
        RevokedAtUtc = utcNow;
    }
}
