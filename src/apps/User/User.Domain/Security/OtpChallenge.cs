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
        int maxAttempts,
        OtpPurpose purpose)
    {
        Id = id;
        PhoneNumberNormalized = phoneNumberNormalized;
        OtpHash = otpHash;
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = expiresAtUtc;
        MaxAttempts = maxAttempts;
        Purpose = purpose;
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

    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (fix wave S-A1, D-159): which door the code was issued for. A farmer-app code
    /// is checked only by the farmer sign-in and a control-room code only by the console's own door; each door counts its
    /// own codes. Rows written before the column existed, and by an older binary, are farmer-app codes (the column's
    /// constant default).
    /// </summary>
    public OtpPurpose Purpose { get; private set; } = OtpPurpose.FarmerApp;

    public bool IsPending => Status == OtpChallengeStatus.Pending;

    public static OtpChallenge Issue(
        Guid id,
        string phoneNumberNormalized,
        string otpHash,
        DateTime utcNow,
        TimeSpan ttl,
        int maxAttempts,
        OtpPurpose purpose = OtpPurpose.FarmerApp)
    {
        if (id == Guid.Empty) throw new ArgumentException("Id required.", nameof(id));
        if (string.IsNullOrWhiteSpace(phoneNumberNormalized)) throw new ArgumentException("Phone required.", nameof(phoneNumberNormalized));
        if (string.IsNullOrWhiteSpace(otpHash)) throw new ArgumentException("OTP hash required.", nameof(otpHash));
        if (ttl <= TimeSpan.Zero) throw new ArgumentException("TTL must be positive.", nameof(ttl));
        if (maxAttempts <= 0) throw new ArgumentException("Max attempts must be positive.", nameof(maxAttempts));
        if (!Enum.IsDefined(purpose)) throw new ArgumentException("Unknown purpose.", nameof(purpose));

        return new OtpChallenge(id, phoneNumberNormalized, otpHash, utcNow, utcNow.Add(ttl), maxAttempts, purpose);
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
    /// <para>This counts the attempt in memory only. The sign-in handler counts it where every parallel guess sees it first
    /// (<see cref="TryCountAttempt"/> / the repository's conditional update) and then calls
    /// <see cref="ApplyCountedAttempt"/>.</para>
    /// </summary>
    public OtpVerificationOutcome Verify(bool otpMatches, DateTime utcNow)
    {
        if (Status != OtpChallengeStatus.Pending)
        {
            return OtpVerificationOutcome.AlreadyConsumed;
        }

        if (ExpireIfLapsed(utcNow))
        {
            return OtpVerificationOutcome.Expired;
        }

        AttemptCount++;
        return Decide(otpMatches, utcNow);
    }

    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (fix wave S-A2, AU-F2). A pending code past its expiry is marked
    /// <see cref="OtpChallengeStatus.Expired"/> (true); otherwise nothing changes (false). No guess is counted.
    /// </summary>
    public bool ExpireIfLapsed(DateTime utcNow)
    {
        if (Status != OtpChallengeStatus.Pending || utcNow < ExpiresAtUtc)
        {
            return false;
        }

        Status = OtpChallengeStatus.Expired;
        return true;
    }

    /// <summary>
    /// S-A2: counts one guess, only while the code is pending, unexpired and under <see cref="MaxAttempts"/>; false (and
    /// nothing changes) otherwise, and that guess must not be checked. This is the in-memory form of the repository's
    /// one-statement conditional update (<c>attempt_count + 1 ... WHERE attempt_count &lt; max_attempts</c>), which is
    /// what the sign-in handler relies on so that parallel guesses can never check more than <see cref="MaxAttempts"/>.
    /// </summary>
    public bool TryCountAttempt(DateTime utcNow)
    {
        if (Status != OtpChallengeStatus.Pending || utcNow >= ExpiresAtUtc || AttemptCount >= MaxAttempts)
        {
            return false;
        }

        AttemptCount++;
        return true;
    }

    /// <summary>
    /// S-A2: the outcome of a guess that was already counted (<see cref="AttemptCount"/> includes it). A wrong guess
    /// that used the last attempt locks the code; a right one consumes it. A code no longer pending (a parallel guess
    /// used or locked it) answers <see cref="OtpVerificationOutcome.AlreadyConsumed"/>.
    /// </summary>
    public OtpVerificationOutcome ApplyCountedAttempt(bool otpMatches, DateTime utcNow)
    {
        if (Status != OtpChallengeStatus.Pending)
        {
            return OtpVerificationOutcome.AlreadyConsumed;
        }

        if (ExpireIfLapsed(utcNow))
        {
            return OtpVerificationOutcome.Expired;
        }

        return Decide(otpMatches, utcNow);
    }

    private OtpVerificationOutcome Decide(bool otpMatches, DateTime utcNow)
    {
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

/// <summary>
/// spec: trusted-control-room-2026-11-20 (fix wave S-A1, D-159): the door a one-time code belongs to. Stored as a
/// smallint; the column's constant default is <see cref="FarmerApp"/>, so every existing row and every row an older
/// binary writes stays a farmer-app code.
/// </summary>
public enum OtpPurpose : short
{
    /// <summary>The farmer app's SMS sign-in (<c>/user/auth/start-otp</c>, <c>/user/auth/verify-otp</c>).</summary>
    FarmerApp = 1,

    /// <summary>The control room's own sign-in door (<c>/shramsafal/admin/sign-in/*</c>).</summary>
    ControlRoomDoor = 2,
}
