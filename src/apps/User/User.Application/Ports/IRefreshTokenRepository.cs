using User.Domain.Security;

namespace User.Application.Ports;

public interface IRefreshTokenRepository
{
    Task<RefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default);
    Task AddAsync(RefreshToken refreshToken, CancellationToken ct = default);
    Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default);
    Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 lane NP-1 — true when THIS account has a session row on <paramref name="deviceId"/> that is not
    /// held for the new-phone question: the phone is known (it said होय, it made the account, or it was signed in
    /// before the question existed). Another account's rows never count.
    /// </summary>
    Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
