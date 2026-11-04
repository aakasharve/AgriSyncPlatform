namespace ShramSafal.Domain.Identity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. One card code of a person (R6): random, issued
/// automatically when a worker is added, and NEVER reused — the code is the primary key and no row is ever deleted, so a
/// retired code (a reissue, case 13, or an erasure, R8) can never be issued to anyone again.
/// </summary>
public sealed class ShramCard
{
    private ShramCard() { } // EF Core

    private ShramCard(string code, Guid personId, Guid? issuedByFarmId, DateTime issuedAtUtc)
    {
        Code = code;
        PersonId = personId;
        IssuedByFarmId = issuedByFarmId;
        IssuedAtUtc = issuedAtUtc;
    }

    /// <summary>The 8-character body (<see cref="ShramCardCode"/>); shown as <c>SS-XXXX-XXXX</c>.</summary>
    public string Code { get; private set; } = string.Empty;

    public Guid PersonId { get; private set; }
    public Guid? IssuedByFarmId { get; private set; }
    public DateTime IssuedAtUtc { get; private set; }
    public DateTime? RetiredAtUtc { get; private set; }

    /// <summary>The code that replaced this one on a reissue (none when retired by erasure).</summary>
    public string? ReplacedByCode { get; private set; }

    public bool IsActive => RetiredAtUtc is null;

    public static ShramCard Issue(string code, Guid personId, Guid? issuedByFarmId, DateTime issuedAtUtc)
    {
        var body = ShramCardCode.Normalize(code);
        if (body is null || body != code)
        {
            throw new ArgumentException("A card code is 8 characters of the card alphabet.", nameof(code));
        }

        if (personId == Guid.Empty)
        {
            throw new ArgumentException("A card belongs to a person.", nameof(personId));
        }

        return new ShramCard(code, personId, issuedByFarmId, issuedAtUtc);
    }

    /// <summary>"हे कार्ड आता चालत नाही" — the code stays on record so it is never issued again.</summary>
    public void Retire(DateTime atUtc, string? replacedByCode)
    {
        if (RetiredAtUtc is not null)
        {
            return;
        }

        RetiredAtUtc = atUtc;
        ReplacedByCode = replacedByCode;
    }
}
