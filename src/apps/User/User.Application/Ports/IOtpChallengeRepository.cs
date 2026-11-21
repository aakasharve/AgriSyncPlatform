using User.Domain.Security;

namespace User.Application.Ports;

public interface IOtpChallengeRepository
{
    Task AddAsync(OtpChallenge challenge, CancellationToken ct = default);

    /// <summary>
    /// Returns the single Pending challenge for a phone and purpose, if any.
    /// Multiple Pending challenges for the same phone and purpose are prevented
    /// by a partial unique index (invariant: at most one Pending per phone per
    /// door at a time — plan §5.2 rate-limit reinforcement). spec:
    /// trusted-control-room-2026-11-20 (fix wave S-A1): a farmer-app code and a
    /// control-room code never see each other.
    /// </summary>
    Task<OtpChallenge?> GetPendingByPhoneAsync(string phoneNumberNormalized, OtpPurpose purpose, CancellationToken ct = default);

    /// <summary>
    /// Count of challenges of one purpose issued for a phone within a rolling
    /// window. Used by the handler to enforce plan §5.2 rate limits (farmer
    /// app: 3 per 15 min, 6 per 24 h) and the control-room door's own limits
    /// (1 per minute, 10 per hour). Each door counts only its own codes.
    /// </summary>
    Task<int> CountIssuedSinceAsync(string phoneNumberNormalized, OtpPurpose purpose, DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (fix wave S-A2, AU-F2). Counts one guess on
    /// <paramref name="challenge"/> where every parallel guess sees it, in ONE conditional statement: the attempt count
    /// goes up by one only while the code is still pending, unexpired and under its maximum. The challenge's state is
    /// then re-read, so <see cref="OtpChallenge.AttemptCount"/> and <see cref="OtpChallenge.Status"/> include what other
    /// guesses did. True when this guess was counted and may be checked; false when it was not (the code was used, locked
    /// or expired, possibly by a parallel guess) and it must not be checked.
    /// </summary>
    Task<bool> TryCountAttemptAsync(OtpChallenge challenge, DateTime utcNow, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
