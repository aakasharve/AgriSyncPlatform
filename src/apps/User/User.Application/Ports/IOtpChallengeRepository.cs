using User.Domain.Security;

namespace User.Application.Ports;

public interface IOtpChallengeRepository
{
    Task AddAsync(OtpChallenge challenge, CancellationToken ct = default);

    /// <summary>
    /// Returns the single Pending challenge for a phone, if any.
    /// Multiple Pending challenges for the same phone are prevented by a
    /// partial unique index (invariant: at most one Pending per phone at a
    /// time — plan §5.2 rate-limit reinforcement).
    /// </summary>
    Task<OtpChallenge?> GetPendingByPhoneAsync(string phoneNumberNormalized, CancellationToken ct = default);

    /// <summary>
    /// Count of challenges issued for a phone within a rolling window.
    /// Used by the handler to enforce plan §5.2 rate limits
    /// (3 per 15 min, 6 per 24 h).
    /// </summary>
    Task<int> CountIssuedSinceAsync(string phoneNumberNormalized, DateTime sinceUtc, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
