// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - the pure rules of a person's own identity card.
namespace User.Domain.Identity;

/// <summary>The script a full name is written in, as the card reports it (<c>fullNameScript</c>): Marathi letters, English letters, or neither.</summary>
public enum NameScript
{
    Other = 0,
    Devanagari = 1,
    Latin = 2,
}

/// <summary>
/// The card's rules, pure (no I/O): which letters a Marathi or an English name may hold, how a PIN and a Farmer ID are read (Marathi digits are
/// accepted and kept as ASCII digits), and the lengths. Nothing here guesses or converts a name.
/// </summary>
public static class IdentityRules
{
    public const int MaxNameLength = 100;
    public const int MaxFarmerIdLength = 32;
    public const int MaxPlaceLength = 100;
    public const int MaxAppVersionLength = 32;

    private const char ZeroWidthNonJoiner = '‌';
    private const char ZeroWidthJoiner = '‍';

    /// <summary>A name of at most <see cref="MaxNameLength"/> characters.</summary>
    public static bool FitsName(string value) => value.Length <= MaxNameLength;

    /// <summary>Marathi letters (the Devanagari block, with the joiners Marathi writing uses), spaces, <c>.</c>, <c>'</c> and <c>-</c>; at least one letter.</summary>
    public static bool IsMarathiName(string value) =>
        value.Any(IsDevanagari) && value.All(c => IsDevanagari(c) || c is ZeroWidthNonJoiner or ZeroWidthJoiner || IsNamePunctuation(c));

    /// <summary>English letters (A-Z, a-z and the Latin letters with marks), spaces, <c>.</c>, <c>'</c> and <c>-</c>; at least one letter.</summary>
    public static bool IsEnglishName(string value) =>
        value.Any(IsLatinLetter) && value.All(c => IsLatinLetter(c) || IsNamePunctuation(c));

    /// <summary>The script of a full name: Devanagari when every letter is Marathi, Latin when every letter is English, else Other.</summary>
    public static NameScript ScriptOf(string? value)
    {
        var letters = (value ?? string.Empty).Where(char.IsLetter).ToList();
        if (letters.Count == 0)
        {
            return NameScript.Other;
        }

        if (letters.All(IsDevanagari))
        {
            return NameScript.Devanagari;
        }

        return letters.All(IsLatinLetter) ? NameScript.Latin : NameScript.Other;
    }

    /// <summary>The wire word for <see cref="ScriptOf"/>: <c>deva</c>, <c>latn</c> or <c>other</c>.</summary>
    public static string ScriptTag(string? value) => ScriptOf(value) switch
    {
        NameScript.Devanagari => "deva",
        NameScript.Latin => "latn",
        _ => "other",
    };

    /// <summary>True when the text holds at least one Marathi (Devanagari) character: a typed place is kept in its Marathi name then.</summary>
    public static bool HasMarathi(string value) => value.Any(IsDevanagari);

    /// <summary>Marathi digits (०-९) as ASCII digits; every other character unchanged.</summary>
    public static string ToAsciiDigits(string value) =>
        new(value.Select(c => c is >= '०' and <= '९' ? (char)('0' + (c - '०')) : c).ToArray());

    /// <summary>
    /// A PIN as typed (Marathi or ASCII digits, spaces allowed) read as six ASCII digits not starting with 0, or <c>null</c> when it is not one.
    /// </summary>
    public static string? NormalizePin(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var digits = ToAsciiDigits(new string(value.Where(c => !char.IsWhiteSpace(c)).ToArray()));
        return digits.Length == 6 && digits.All(char.IsAsciiDigit) && digits[0] != '0' ? digits : null;
    }

    /// <summary>
    /// A Farmer ID as typed: trimmed, Marathi digits as ASCII; at most <see cref="MaxFarmerIdLength"/> characters of digits, A-Z, a-z, space and
    /// <c>-</c>. Returns <c>null</c> when it breaks that rule (the caller refuses it) and the empty string when nothing was typed.
    /// </summary>
    public static string? NormalizeFarmerId(string? value)
    {
        var text = ToAsciiDigits((value ?? string.Empty).Trim());
        if (text.Length == 0)
        {
            return string.Empty;
        }

        return text.Length <= MaxFarmerIdLength && text.All(c => char.IsAsciiLetterOrDigit(c) || c is ' ' or '-') ? text : null;
    }

    /// <summary>The app version as stored: at most <see cref="MaxAppVersionLength"/> characters, nothing when blank.</summary>
    public static string? AppVersionOf(string? appVersion)
    {
        var text = appVersion?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        return text.Length <= MaxAppVersionLength ? text : text[..MaxAppVersionLength];
    }

    private static bool IsDevanagari(char c) => c is >= 'ऀ' and <= 'ॿ';

    private static bool IsLatinLetter(char c) =>
        char.IsAsciiLetter(c) || (char.IsLetter(c) && c is >= 'À' and <= 'ɏ');

    private static bool IsNamePunctuation(char c) => c is ' ' or '.' or '\'' or '-';
}
