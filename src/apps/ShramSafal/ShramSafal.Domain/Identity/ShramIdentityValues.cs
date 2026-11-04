using System.Security.Cryptography;

namespace ShramSafal.Domain.Identity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 FINAL, 2026-10-30). The small, pure values
/// of a worker's ShramSafal identity (श्रम ओळख): the card code, the phone number, the home PIN code and the closed words
/// the identity tables store. Nothing here touches a farm: these are ShramSafal-wide (the design's F8 exception).
/// </summary>
public enum PhoneWhose
{
    /// <summary>स्वतःचा — his own phone (the default).</summary>
    Own = 0,

    /// <summary>घरचा — a family member's phone (case 2: one family phone, two people).</summary>
    Family = 1,

    /// <summary>मुकादमचा — the मुकादम's phone (case 4: one number typed for his whole gang).</summary>
    Mukadam = 2,
}

/// <summary>The ladder (design §3), lowest to highest. Aadhaar is never a level here (D-55, R7).</summary>
public enum IdentityLevel
{
    /// <summary>नाव — the owner's word only (no working card: an erased person, or a row an older server made).</summary>
    Name = 0,

    /// <summary>कार्ड — a working card, issued automatically on add.</summary>
    Card = 1,

    /// <summary>फोन पडताळलेला — he proved a phone with a one-time code.</summary>
    PhoneVerified = 2,
}

/// <summary>How a change was proven (R5: who, when, and which proof).</summary>
public enum IdentityProof
{
    None = 0,

    /// <summary>His card, shown in person (scanned or its code typed from it).</summary>
    CardShown = 1,

    /// <summary>A one-time code sent to his phone and read back.</summary>
    PhoneCode = 2,

    /// <summary>An owner on a farm where he is known confirms him (cases 5 and 13), or undoes his own act.</summary>
    OwnerConfirms = 3,
}

/// <summary>Every append-only identity event (R5).</summary>
public enum IdentityEventKind
{
    CardIssued = 0,
    Linked = 1,
    Unlinked = 2,
    PhoneAdded = 3,
    PhoneVerified = 4,
    NumberMoved = 5,
    CardReissued = 6,
    Merged = 7,
    Unmerged = 8,
    PinSet = 9,
    ErasureRequested = 10,
    ErasureCancelled = 11,
    Erased = 12,
}

/// <summary>What a one-time code is for; a code proves only the purpose it was sent for.</summary>
public enum ChallengePurpose
{
    /// <summary>Prove the contact phone this farm entered for him (screen 3).</summary>
    Verify = 0,

    /// <summary>His consent to be linked on another farm (screen 5).</summary>
    Link = 1,

    /// <summary>Case 5: he holds the NEW number.</summary>
    MoveNew = 2,

    /// <summary>Case 5: the OLD verified number still works.</summary>
    MoveOld = 3,

    /// <summary>Case 13: a new card for a lost or stolen one.</summary>
    Reissue = 4,
}

/// <summary>
/// The card code (R6): 8 random characters from Crockford's base-32 alphabet (no I, L, O, U), shown as
/// <c>SS-7K4M-29QX</c>. 40 random bits from the system's cryptographic generator; never derived from a name, a number or
/// a farm. The QR holds only <see cref="QrPayload"/>.
/// </summary>
public static class ShramCardCode
{
    public const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    public const int Length = 8;
    public const string UrlPrefix = "https://shramsafal.in/w/";

    /// <summary>A fresh random code body (8 characters). Uniqueness is the database's (primary key): a clash is retried.</summary>
    public static string NewBody()
    {
        Span<char> chars = stackalloc char[Length];
        for (var i = 0; i < Length; i++)
        {
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        }

        return new string(chars);
    }

    /// <summary>
    /// The 8-character body of whatever the owner scanned or typed — <c>SS-7K4M-29QX</c>, <c>ss 7k4m 29qx</c>,
    /// <c>7K4M29QX</c> or the QR's <c>https://shramsafal.in/w/SS-7K4M-29QX</c> — or <c>null</c> when it is not a card code.
    /// The characters people confuse are read as the alphabet means them (O as 0, I and L as 1).
    /// </summary>
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return null;
        }

        var text = input.Trim();
        var slash = text.LastIndexOf("/w/", StringComparison.OrdinalIgnoreCase);
        if (slash >= 0)
        {
            text = text[(slash + 3)..];
        }

        var kept = new System.Text.StringBuilder(text.Length);
        foreach (var raw in text.ToUpperInvariant())
        {
            if (raw is ' ' or '-' or '.' or '_' or '/')
            {
                continue;
            }

            kept.Append(raw switch
            {
                'O' => '0',
                'I' or 'L' => '1',
                _ => raw,
            });
        }

        var body = kept.ToString();
        if (body.Length == Length + 2 && body.StartsWith("SS", StringComparison.Ordinal))
        {
            body = body[2..];
        }

        return body.Length == Length && body.All(c => Alphabet.Contains(c)) ? body : null;
    }

    /// <summary><c>SS-XXXX-XXXX</c>.</summary>
    public static string Display(string body) => $"SS-{body[..4]}-{body[4..]}";

    /// <summary>What the QR holds — only the code, never a name, a number or Aadhaar (R6).</summary>
    public static string QrPayload(string body) => UrlPrefix + Display(body);
}

/// <summary>An Indian mobile number, stored as <c>+91</c> and ten digits (first digit 6–9).</summary>
public static class IndianMobile
{
    /// <summary><c>+91XXXXXXXXXX</c>, or <c>null</c> when the text is not an Indian mobile number.</summary>
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return null;
        }

        var digits = new string(input.Where(char.IsAsciiDigit).ToArray());
        if (digits.Length == 12 && digits.StartsWith("91", StringComparison.Ordinal))
        {
            digits = digits[2..];
        }
        else if (digits.Length == 11 && digits[0] == '0')
        {
            digits = digits[1..];
        }

        return digits.Length == 10 && digits[0] is >= '6' and <= '9' ? "+91" + digits : null;
    }

    /// <summary>The last <paramref name="count"/> digits, the most any screen ever shows of a number.</summary>
    public static string Tail(string e164, int count = 4) => e164.Length <= count ? e164 : e164[^count..];
}

/// <summary>The home PIN code (R11, §10): exactly 6 digits, the first 1–9. Never a street, village or address.</summary>
public static class HomePinCode
{
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return null;
        }

        var digits = new string(input.Where(c => !char.IsWhiteSpace(c)).ToArray());
        return digits.Length == 6 && digits.All(char.IsAsciiDigit) && digits[0] != '0' ? digits : null;
    }
}
