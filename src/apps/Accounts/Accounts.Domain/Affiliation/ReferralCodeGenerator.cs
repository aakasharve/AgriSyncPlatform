namespace Accounts.Domain.Affiliation;

/// <summary>
/// Generates ambiguity-free 8-character uppercase Crockford Base32 codes.
/// Crockford removes I, L, O, U to avoid confusion with 1, 1, 0, V.
/// </summary>
public static class ReferralCodeGenerator
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 chars

    public static string Generate(Guid seed)
    {
        // Use deterministic shuffle of the seed bytes for testability.
        var bytes = seed.ToByteArray();
        var chars = new char[8];
        for (var i = 0; i < 8; i++)
        {
            // XOR adjacent bytes for each position to distribute entropy.
            var index = (bytes[i] ^ bytes[(i + 8) % 16]) % 32;
            chars[i] = Alphabet[index];
        }
        return new string(chars);
    }
}
