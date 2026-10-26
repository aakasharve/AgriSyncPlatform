// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using System.Security.Cryptography;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the ONE generator and the ONE reader of a
/// farm's code. Before this, two private copies of the generator lived in
/// <c>FirstFarmBootstrapEndpoints</c> and <c>BackfillFarmOwnerAccounts</c>, and four other
/// farm-creation paths (<c>CreateFarmHandler</c>, the demo / dev / e2e seeders) made farms with
/// no code at all — which is why the owner's QR sheet showed a blank code (D-1).
///
/// <para><b>Shape.</b> Six characters of Crockford base32 (digits + letters without I, L, O, U):
/// 32^6 ≈ 1.07 billion codes, drawn from the OS CSPRNG. 256 is a multiple of 32, so
/// <c>byte % 32</c> carries no modulo bias. Uniqueness is the database's job
/// (<c>ux_farms_farm_code</c>), never this class's.</para>
///
/// <para><b>What a typed code can do.</b> Only ask to join: <c>POST /shramsafal/join/by-code</c>
/// creates a <see cref="MembershipStatus.PendingApproval"/> seat that the farm's owner must
/// approve, and the person typing never chooses a role. That seat reads and writes nothing of
/// the farm: the data and operational gates count ACTIVE seats only (BN-1, landed with step 1).
/// A wrong code gets the same answer as an unknown one and is rate-limited.</para>
/// </summary>
public static class FarmCode
{
    public const int Length = 6;

    /// <summary>Crockford base32. Every code ever generated uses only these characters.</summary>
    public const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    /// <summary>A fresh random code. Callers persist it through <c>Farm.AssignFarmCode</c>.</summary>
    public static string New()
    {
        Span<byte> bytes = stackalloc byte[Length];
        RandomNumberGenerator.Fill(bytes);
        Span<char> chars = stackalloc char[Length];
        for (var i = 0; i < Length; i++)
        {
            chars[i] = Alphabet[bytes[i] % Alphabet.Length];
        }

        return new string(chars);
    }

    /// <summary>
    /// Reads a code the way a farmer types it: case, spaces and hyphens do not matter, the
    /// look-alikes Crockford folds are folded (I and L read as 1, O as 0), and digits typed on a
    /// Marathi keyboard (०–९) read as 0–9. Returns <c>null</c> when what is left is not a
    /// well-formed code; the caller must answer that exactly as it answers an unknown code.
    /// </summary>
    public static string? Normalize(string? typed)
    {
        if (string.IsNullOrWhiteSpace(typed))
        {
            return null;
        }

        Span<char> code = stackalloc char[Length];
        var count = 0;
        foreach (var raw in typed)
        {
            if (char.IsWhiteSpace(raw) || raw == '-')
            {
                continue;
            }

            char c;
            if (char.IsDigit(raw))
            {
                // Any Unicode decimal digit (Devanagari included) → its ASCII digit.
                c = (char)('0' + (int)char.GetNumericValue(raw));
            }
            else
            {
                c = char.ToUpperInvariant(raw) switch
                {
                    'I' or 'L' => '1',
                    'O' => '0',
                    var upper => upper,
                };
            }

            if (count == Length || Alphabet.IndexOf(c) < 0)
            {
                return null;
            }

            code[count++] = c;
        }

        return count == Length ? new string(code) : null;
    }
}
