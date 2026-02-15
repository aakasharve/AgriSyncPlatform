using Microsoft.EntityFrameworkCore;
using AgriSync.SharedKernel.Contracts.Ids;
using User.Application.Ports;
using User.Domain.Security;

namespace User.Infrastructure.Persistence.Repositories;

internal sealed class RefreshTokenRepository(UserDbContext db) : IRefreshTokenRepository
{
    public async Task<RefreshToken?> GetByTokenAsync(string token, CancellationToken ct = default)
    {
        return await db.RefreshTokens.FirstOrDefaultAsync(t => t.Token == token, ct);
    }

    public async Task AddAsync(RefreshToken refreshToken, CancellationToken ct = default)
    {
        await db.RefreshTokens.AddAsync(refreshToken, ct);
    }

    public async Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var typedUserId = new UserId(userId);
        var activeTokens = await db.RefreshTokens
            .Where(t => t.UserId == typedUserId && t.RevokedAtUtc == null)
            .ToListAsync(ct);

        foreach (var token in activeTokens)
        {
            token.Revoke(utcNow);
        }
    }

    public async Task SaveChangesAsync(CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
    }
}
