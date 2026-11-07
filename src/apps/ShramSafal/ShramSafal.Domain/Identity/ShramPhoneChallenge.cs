using System.Security.Cryptography;
using System.Text;
using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Identity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. One one-time code sent to a person's phone (screen 3:
/// "4 अंकी कोड"). Only a hash is kept (the code itself is never stored); it proves only the <see cref="Purpose"/> and the
/// person it was sent for, expires, allows a few tries, and is spent once used.
/// </summary>
public sealed class ShramPhoneChallenge : Entity<Guid>
{
    public const int CodeLength = 4;
    public const int MaxAttempts = 5;
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    private ShramPhoneChallenge() : base(Guid.Empty) { } // EF Core

    private ShramPhoneChallenge(
        Guid id, Guid personId, string phoneE164, ChallengePurpose purpose, Guid requestedByFarmId, Guid requestedByUserId,
        string codeHash, DateTime createdAtUtc)
        : base(id)
    {
        PersonId = personId;
        PhoneE164 = phoneE164;
        Purpose = purpose;
        RequestedByFarmId = requestedByFarmId;
        RequestedByUserId = requestedByUserId;
        CodeHash = codeHash;
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = createdAtUtc + Lifetime;
    }

    public Guid PersonId { get; private set; }

    /// <summary>The number the code went to; <c>null</c> once the person is erased (R8).</summary>
    public string? PhoneE164 { get; private set; }

    public ChallengePurpose Purpose { get; private set; }
    public Guid RequestedByFarmId { get; private set; }
    public Guid RequestedByUserId { get; private set; }
    public string CodeHash { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public int Attempts { get; private set; }
    public DateTime? ConsumedAtUtc { get; private set; }

    /// <summary>A fresh random code (four digits, as the approved screen shows).</summary>
    public static string NewCode() => RandomNumberGenerator.GetInt32(0, 10_000).ToString("D4", System.Globalization.CultureInfo.InvariantCulture);

    public static ShramPhoneChallenge Issue(
        Guid id, Guid personId, string phone, ChallengePurpose purpose, Guid requestedByFarmId, Guid requestedByUserId,
        string code, DateTime createdAtUtc)
    {
        var e164 = IndianMobile.Normalize(phone) ?? throw new ArgumentException("Not an Indian mobile number.", nameof(phone));
        if (code.Length != CodeLength || !code.All(char.IsAsciiDigit))
        {
            throw new ArgumentException("A worker code is four digits.", nameof(code));
        }

        return new ShramPhoneChallenge(id, personId, e164, purpose, requestedByFarmId, requestedByUserId, Hash(id, code), createdAtUtc);
    }

    /// <summary>Checks a code read back by the worker. Every wrong try counts; a right one spends the challenge.</summary>
    public ChallengeOutcome TryConsume(string? code, ChallengePurpose purpose, DateTime atUtc)
    {
        if (RefuseBeforeCounting(purpose, atUtc) is { } refused)
        {
            return refused;
        }

        Attempts++;
        return CompareCounted(code, atUtc);
    }

    /// <summary>
    /// Fix pass 3 (review R1) — what refuses a try before it is counted: spent, the wrong purpose, expired, or its tries
    /// used up. <c>null</c>: the try may be counted (the server counts it in one database statement, then compares).
    /// </summary>
    public ChallengeOutcome? RefuseBeforeCounting(ChallengePurpose purpose, DateTime atUtc)
    {
        if (ConsumedAtUtc is not null)
        {
            return ChallengeOutcome.Spent;
        }

        if (purpose != Purpose)
        {
            return ChallengeOutcome.WrongPurpose;
        }

        if (atUtc > ExpiresAtUtc)
        {
            return ChallengeOutcome.Expired;
        }

        return Attempts >= MaxAttempts ? ChallengeOutcome.TooManyTries : null;
    }

    /// <summary>
    /// Fix pass 3 (review R1) — compares the code once this try has been counted (the count is not repeated here). A
    /// right code spends the challenge.
    /// </summary>
    public ChallengeOutcome CompareCounted(string? code, DateTime atUtc)
    {
        var normalized = (code ?? string.Empty).Trim();
        if (normalized.Length != CodeLength
            || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(Id, normalized)), Encoding.ASCII.GetBytes(CodeHash)))
        {
            return ChallengeOutcome.Wrong;
        }

        ConsumedAtUtc = atUtc;
        return ChallengeOutcome.Ok;
    }

    /// <summary>R8 — the number is forgotten.</summary>
    public void ErasePhone() => PhoneE164 = null;

    private static string Hash(Guid id, string code)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{id:N}:{code}")));
}

public enum ChallengeOutcome
{
    Ok = 0,
    Wrong = 1,
    Expired = 2,
    Spent = 3,
    TooManyTries = 4,
    WrongPurpose = 5,
}
