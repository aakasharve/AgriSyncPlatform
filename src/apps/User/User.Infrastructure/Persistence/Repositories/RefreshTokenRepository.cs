using Microsoft.EntityFrameworkCore;
using AgriSync.SharedKernel.Contracts.Ids;
using User.Application.Ports;
using User.Domain.Security;

namespace User.Infrastructure.Persistence.Repositories;

internal sealed class RefreshTokenRepository(UserDbContext db) : IRefreshTokenRepository
{
    public async Task<RefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default)
    {
        return await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == tokenHash, ct);
    }

    public async Task AddAsync(RefreshToken refreshToken, CancellationToken ct = default)
    {
        await db.RefreshTokens.AddAsync(refreshToken, ct);
    }

    public async Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
    {
        var typedUserId = new UserId(userId);
        var activeTokens = await db.RefreshTokens
            .Where(t => t.UserId == typedUserId && t.DeviceId == deviceId && t.RevokedAtUtc == null)
            .ToListAsync(ct);

        foreach (var token in activeTokens)
        {
            token.Revoke(utcNow, reason);
        }
    }

    public async Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default)
    {
        var typedUserId = new UserId(userId);
        var activeTokens = await db.RefreshTokens
            .Where(t => t.UserId == typedUserId && t.RevokedAtUtc == null)
            .ToListAsync(ct);

        foreach (var token in activeTokens)
        {
            token.Revoke(utcNow, reason);
        }
    }

    public async Task SaveChangesAsync(CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
    }
}
