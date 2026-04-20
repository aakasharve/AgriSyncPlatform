namespace User.Domain.Security;

/// <summary>
/// One attempt to authenticate a phone number via OTP.
///
/// A challenge is:
///   - created when the user taps "Send OTP"
///   - succeeds on the first matching verify within the TTL
///   - is destroyed (marked <see cref="OtpChallengeStatus.Consumed"/>,
///     <see cref="OtpChallengeStatus.Expired"/>, or
///     <see cref="OtpChallengeStatus.LockedOut"/>) and never reused
///
/// We store the OTP as a hash (bcrypt) — never plaintext — so even a DB
/// read cannot reveal the active code. Plan §5.2 rate-limit rules apply
/// across challenges (not within one), so the aggregate-level limit
/// ("3 OTPs per phone per 15 min") lives in the handler, not here.
/// </summary>
public sealed class OtpChallenge
{
    private OtpChallenge() { } // EF Core

    private OtpChallenge(
        Guid id,
        string phoneNumberNormalized,
        string otpHash,
        DateTime createdAtUtc,
        DateTime expiresAtUtc,
        int maxAttempts)
    {
        Id = id;
        PhoneNumberNormalized = phoneNumberNormalized;
        OtpHash = otpHash;
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = expiresAtUtc;
        MaxAttempts = maxAttempts;
        Status = OtpChallengeStatus.Pending;
    }

    public Guid Id { get; private set; }
    public string PhoneNumberNormalized { get; private set; } = string.Empty;
    public string OtpHash { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public int MaxAttempts { get; private set; }
    public int AttemptCount { get; private set; }
    public OtpChallengeStatus Status { get; private set; }
    public DateTime? ConsumedAtUtc { get; private set; }

    /// <summary>Provider-side request id (e.g. MSG91 <c>request_id</c>) so operators can trace delivery.</summary>
    public string? ProviderRequestId { get; private set; }

    public bool IsPending => Status == OtpChallengeStatus.Pending;

    public static OtpChallenge Issue(
        Guid id,
        string phoneNumberNormalized,
        string otpHash,
        DateTime utcNow,
        TimeSpan ttl,
        int maxAttempts)
    {
        if (id == Guid.Empty) throw new ArgumentException("Id required.", nameof(id));
        if (string.IsNullOrWhiteSpace(phoneNumberNormalized)) throw new ArgumentException("Phone required.", nameof(phoneNumberNormalized));
        if (string.IsNullOrWhiteSpace(otpHash)) throw new ArgumentException("OTP hash required.", nameof(otpHash));
        if (ttl <= TimeSpan.Zero) throw new ArgumentException("TTL must be positive.", nameof(ttl));
        if (maxAttempts <= 0) throw new ArgumentException("Max attempts must be positive.", nameof(maxAttempts));

        return new OtpChallenge(id, phoneNumberNormalized, otpHash, utcNow, utcNow.Add(ttl), maxAttempts);
    }

    public void AttachProviderRequestId(string providerRequestId)
    {
        if (string.IsNullOrWhiteSpace(providerRequestId)) return;
        ProviderRequestId = providerRequestId;
    }

    /// <summary>
    /// Explicitly invalidate this challenge — e.g. when a newer OTP is
    /// issued for the same phone. Not counted as a failed verify attempt.
    /// </summary>
    public void ExpireManually(DateTime utcNow)
    {
        if (Status != OtpChallengeStatus.Pending) return;
        Status = OtpChallengeStatus.Expired;
        ConsumedAtUtc = utcNow;
    }

    /// <summary>
    /// Apply a verification attempt. The handler pre-computes
    /// <paramref name="otpMatches"/> using the hash-verifier that matches
    /// <see cref="OtpHash"/> (bcrypt uses a random salt, so the domain
    /// cannot re-hash here). The decision graph stays in the aggregate;
    /// the crypto stays outside the domain.
    /// </summary>
    public OtpVerificationOutcome Verify(bool otpMatches, DateTime utcNow)
    {
        if (Status != OtpChallengeStatus.Pending)
        {
            return OtpVerificationOutcome.AlreadyConsumed;
        }

        if (utcNow >= ExpiresAtUtc)
        {
            Status = OtpChallengeStatus.Expired;
            return OtpVerificationOutcome.Expired;
        }

        AttemptCount++;

        if (!otpMatches)
        {
            if (AttemptCount >= MaxAttempts)
            {
                Status = OtpChallengeStatus.LockedOut;
                return OtpVerificationOutcome.LockedOut;
            }

            return OtpVerificationOutcome.Mismatch;
        }

        Status = OtpChallengeStatus.Consumed;
        ConsumedAtUtc = utcNow;
        return OtpVerificationOutcome.Success;
    }
}

public enum OtpChallengeStatus
{
    Pending = 1,
    Consumed = 2,
    Expired = 3,
    LockedOut = 4,
}

public enum OtpVerificationOutcome
{
    Success,
    Mismatch,
    Expired,
    LockedOut,
    AlreadyConsumed,
}
