using System.Text.RegularExpressions;

namespace ShramSafal.Domain.Compare;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane WORK-ID, item I29)
/// <summary>
/// How close two spoken words are: Levenshtein distance (stopping early once it is over 2) and a consonant-skeleton
/// "sounds alike" key. MOVED, not copied, from <c>ShramSafal.Infrastructure.AI.DomainKnowledge.GrapeInputLexicon</c>
/// (its tests are unchanged): the product lexicon and the work vocabulary now read ONE copy, so a word cannot be close
/// to another in one place and far in the other. Pure: no I/O.
/// </summary>
public static class WordDistance
{
    /// <summary>The largest distance the product lexicon and the work vocabulary call "close".</summary>
    public const int CloseDistance = 2;

    /// <summary>
    /// Lowercases and collapses whitespace/hyphens for comparison.
    /// Keeps Devanagari characters intact (they are compared directly).
    /// </summary>
    public static string NormalizeForComparison(string s)
    {
        // Collapse whitespace and hyphens so "6 b a" == "6ba" == "6-ba"
        s = Regex.Replace(s.ToLowerInvariant().Trim(), @"[\s\-]+", "");
        return s;
    }

    /// <summary>
    /// Produces a consonant-skeleton phonetic key over the ASCII-lowercase form.
    /// Maps common STT/Marathi romanization variations to a shared skeleton:
    /// - removes vowels (a, e, i, o, u)
    /// - collapses repeated consonants
    /// - normalises ph→f, th→t, ck→k
    /// So "alphamethrin" and "aplhamitren" both become "llfmtrn" → "lfmtrn".
    /// </summary>
    public static string PhoneticKey(string s)
    {
        if (string.IsNullOrEmpty(s))
            return "";

        // Only apply phonetic key to ASCII-range inputs (skip Devanagari blocks)
        if (ContainsDevanagari(s))
            return s; // compare Devanagari directly

        // Normalize digraphs first
        s = s.Replace("ph", "f")
             .Replace("th", "t")
             .Replace("ck", "k")
             .Replace("gh", "g")
             .Replace("sh", "s")
             .Replace("ch", "c");

        // Remove vowels
        s = Regex.Replace(s, "[aeiou]", "");

        // Collapse repeated consonants
        s = Regex.Replace(s, @"(.)\1+", "$1");

        return s;
    }

    public static bool ContainsDevanagari(string s)
    {
        foreach (var c in s)
        {
            if (c >= 'ऀ' && c <= 'ॿ')
                return true;
        }
        return false;
    }

    /// <summary>
    /// Levenshtein distance (iterative, O(m*n) time, O(min(m,n)) space). Once the best possible result is over
    /// the threshold of 2 it returns a number over 2 (not the exact distance): callers only ask "is it ≤ 2?".
    /// </summary>
    public static int Levenshtein(string s, string t)
    {
        if (s == t) return 0;
        if (s.Length == 0) return t.Length;
        if (t.Length == 0) return s.Length;

        // Early-exit: if lengths differ by more than 2, no point computing
        if (Math.Abs(s.Length - t.Length) > 3)
            return Math.Abs(s.Length - t.Length);

        var prev = new int[t.Length + 1];
        var curr = new int[t.Length + 1];

        for (var j = 0; j <= t.Length; j++)
            prev[j] = j;

        for (var i = 1; i <= s.Length; i++)
        {
            curr[0] = i;
            var rowMin = curr[0];

            for (var j = 1; j <= t.Length; j++)
            {
                var cost = s[i - 1] == t[j - 1] ? 0 : 1;
                curr[j] = Math.Min(
                    Math.Min(curr[j - 1] + 1, prev[j] + 1),
                    prev[j - 1] + cost);
                if (curr[j] < rowMin) rowMin = curr[j];
            }

            // Early exit row: if best possible result in this row > threshold
            if (rowMin > 2)
                return rowMin;

            Array.Copy(curr, prev, t.Length + 1);
        }

        return prev[t.Length];
    }

    /// <summary>Are the two words close: within <see cref="CloseDistance"/> edits (after normalising)?</summary>
    public static bool IsClose(string a, string b)
    {
        var x = NormalizeForComparison(a);
        var y = NormalizeForComparison(b);
        return x.Length > 0 && y.Length > 0 && Levenshtein(x, y) <= CloseDistance;
    }
}
