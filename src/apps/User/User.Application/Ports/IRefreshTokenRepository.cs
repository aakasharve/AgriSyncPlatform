using User.Domain.Security;

namespace User.Application.Ports;

public interface IRefreshTokenRepository
{
    Task<RefreshToken?> GetByTokenAsync(string token, CancellationToken ct = default);
    Task AddAsync(RefreshToken refreshToken, CancellationToken ct = default);
    Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
