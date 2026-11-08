using User.Domain.Security;

namespace User.Application.Ports;

public interface IRefreshTokenRepository
{
    Task<RefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default);
    Task AddAsync(RefreshToken refreshToken, CancellationToken ct = default);
    Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default);
    Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 lane FIX-1 (register F131; the NP-1 review's M1) — ends only the sessions of THIS account on
    /// <paramref name="deviceId"/> that are themselves held for the new-phone question (asked, not yet answered) and still active.
    /// Never a normal session: the placeholder ids <c>unknown</c> (no id sent: the admin console, phones on 1.0.15–1.0.17) and
    /// <c>legacy</c> are shared by many sessions of one account, so "everything on that id" would sign the real owner out
    /// when a stranger's held sign-in or his "नाही" lands on one of them. What a held session may end, a held session
    /// replaces: one open question per phone id.
    /// </summary>
    Task RevokeHeldForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 lane NP-1 — true when THIS account has a session row on <paramref name="deviceId"/> that is not
    /// held for the new-phone question: the phone is known (it said होय, it made the account, or it was signed in
    /// before the question existed). Another account's rows never count.
    /// </summary>
    Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
