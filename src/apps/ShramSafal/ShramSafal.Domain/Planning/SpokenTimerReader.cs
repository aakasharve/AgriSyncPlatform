namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, "voice fills the timer")

/// <summary>
/// The timer the farmer SAID, mapped onto the three timers a work holds (<see cref="ScheduleTimerKind"/>; a work holds exactly one, so this holds one).
/// Every field is named after the field of <see cref="ScheduleTaskTiming"/> it fills. Only the fields of <see cref="Kind"/> are set.
/// </summary>
/// <param name="Kind">Day, After or Sign (never None).</param>
/// <param name="FromDay">Day: the STORED day (shown day - 1: "दहाव्या दिवशी" is 9; "छाटणीनंतर पंधरा दिवसांनी" is stored 15, the book's "N days after pruning" is day N+1).</param>
/// <param name="AfterWorkWords">After: the words of the work this one follows ("पेस्ट"). The phone finds that work's task key; the reader never invents a key.</param>
/// <param name="UsualDays">After: the number of days after that work (<see cref="ScheduleTaskTiming.UsualDays"/>).</param>
/// <param name="SignWords">Sign: what is to be seen ("फूट"; <see cref="ScheduleTaskTiming.SignWords"/>).</param>
/// <param name="HeardWords">The exact words of the sentence this timer was read from (P8: the phone shows what was heard).</param>
public sealed record SpokenTimer(
    ScheduleTimerKind Kind,
    int? FromDay,
    string? AfterWorkWords,
    int? UsualDays,
    string? SignWords,
    string HeardWords);

/// <summary>
/// A DETERMINISTIC reader of the farmer's own words (no model, no guess, no I/O, no clock). It returns a timer only when it is sure; anything unclear
/// (a range, a vague word, a day count with no start, two timers of one kind, a number it does not know) returns null: never a partial guess, never a
/// default. A work holds exactly ONE timer, so when he says an "after" (or a day) AND a "when seen" together, the counted one is kept and the sign is
/// left out (the words he said are still in <see cref="SpokenTimer.HeardWords"/> only for the part that was read).
/// </summary>
public static class SpokenTimerReader
{
    private sealed record Token(string Text, int Start, int End, int Clause);

    // Words that make a timer a range or a vague hint: the whole sentence is unclear.
    private static readonly HashSet<string> Vague = new(StringComparer.Ordinal)
    {
        "ते", "किंवा", "सुमारे", "अंदाजे", "साधारण", "साधारणपणे", "जवळपास", "थोड्या", "थोडे", "थोडा", "काही", "लवकर", "उशिरा",
        "आठवड्यात", "आठवड्याने", "आठवड्यांनी", "आठवडा", "आठवडे", "महिन्यात", "महिन्याने", "महिन्यांनी", "महिना", "महिने",
    };

    private static readonly string[] DayCounters = ["दिवसांनी", "दिवसानंतर", "दिवसांनंतर", "दिवसाने", "दिवसांत", "दिवसात"];
    private static readonly string[] SignVerbPrefixes = ["दिसल", "दिसता", "दिसू"];
    private static readonly string[] SignFillers = ["जेव्हा", "जेंव्हा", "जेव्हां", "मग", "आणि", "तर", "की"];

    private static readonly Dictionary<string, int> Cardinals = BuildCardinals();
    private static readonly Dictionary<string, int> Ordinals = BuildOrdinals(Cardinals);

    public static SpokenTimer? Read(string? words)
    {
        if (string.IsNullOrWhiteSpace(words))
        {
            return null;
        }

        var tokens = Tokenize(words);
        if (tokens.Count == 0 || tokens.Any(t => Vague.Contains(t.Text)))
        {
            return null;
        }

        var consumed = new bool[tokens.Count];
        var counted = new List<SpokenTimer>();
        var countedEnd = new Dictionary<int, int>(); // clause -> the last token index a counted timer used

        // ---- "<work>नंतर <N> दिवसांनी" (a day counted from pruning, or N days after a named work) ----
        for (var i = 0; i < tokens.Count; i++)
        {
            string? work = null;
            var firstWorkToken = i;
            var numberAt = i + 1;
            var text = tokens[i].Text;
            if (text.EndsWith("नंतर", StringComparison.Ordinal) && text.Length > "नंतर".Length)
            {
                work = text[..^"नंतर".Length];
            }
            else if (text == "नंतर" && i > 0 && tokens[i - 1].Clause == tokens[i].Clause)
            {
                work = tokens[i - 1].Text;
                firstWorkToken = i - 1;
            }

            if (work is null || numberAt + 1 >= tokens.Count)
            {
                continue;
            }

            var n = tokens[numberAt];
            var counter = tokens[numberAt + 1];
            if (n.Clause != tokens[i].Clause || counter.Clause != n.Clause
                || !DayCounters.Contains(counter.Text, StringComparer.Ordinal))
            {
                continue;
            }

            var days = ReadCardinal(n.Text);
            if (days is null or < 1)
            {
                return null; // a number he said that we do not know: unclear, and the counter is never left unexplained
            }

            if (work.Any(char.IsDigit) || work.Length == 0)
            {
                return null;
            }

            var heard = words[tokens[firstWorkToken].Start..counter.End];
            counted.Add(work.StartsWith("छाट", StringComparison.Ordinal)
                ? new SpokenTimer(ScheduleTimerKind.Day, days, null, null, null, heard)
                : new SpokenTimer(ScheduleTimerKind.After, null, work, days, null, heard));
            for (var k = firstWorkToken; k <= numberAt + 1; k++)
            {
                consumed[k] = true;
            }

            countedEnd[tokens[i].Clause] = numberAt + 1;
        }

        // ---- "<ordinal> दिवशी" (the Nth day, counted from the start) ----
        for (var i = 0; i + 1 < tokens.Count; i++)
        {
            if (tokens[i + 1].Text != "दिवशी" || tokens[i].Clause != tokens[i + 1].Clause || consumed[i] || consumed[i + 1])
            {
                continue;
            }

            var shown = ReadOrdinal(tokens[i].Text);
            if (shown is null or < 1 || shown - 1 > ScheduleTaskTiming.MaxDay)
            {
                return null;
            }

            counted.Add(new SpokenTimer(ScheduleTimerKind.Day, ScheduleDayNumbers.StoredFromShown(shown.Value), null, null, null,
                words[tokens[i].Start..tokens[i + 1].End]));
            consumed[i] = consumed[i + 1] = true;
            countedEnd[tokens[i].Clause] = i + 1;
        }

        // A counter ("दिवसांनी", "दिवशी") that no pattern above explained is unclear: "आठ दिवसांनी" (from what?), "थोड्या दिवसांनी", a range.
        for (var i = 0; i < tokens.Count; i++)
        {
            if (!consumed[i] && (tokens[i].Text == "दिवशी" || DayCounters.Contains(tokens[i].Text, StringComparer.Ordinal)))
            {
                return null;
            }
        }

        if (counted.Count > 1)
        {
            return null; // two counted timers: which one is his? never a guess
        }

        if (counted.Count == 1)
        {
            return counted[0];
        }

        // ---- "<sign> दिसली की" (when seen) ----
        var signs = new List<SpokenTimer>();
        for (var v = 0; v < tokens.Count; v++)
        {
            if (!SignVerbPrefixes.Any(p => tokens[v].Text.StartsWith(p, StringComparison.Ordinal)))
            {
                continue;
            }

            var clause = tokens[v].Clause;
            var from = v;
            while (from > 0 && tokens[from - 1].Clause == clause)
            {
                from--;
            }

            var signTokens = tokens.Skip(from).Take(v - from)
                .SkipWhile(t => SignFillers.Contains(t.Text, StringComparer.Ordinal))
                .ToList();
            if (signTokens.Count is < 1 or > 2 || signTokens.Any(t => ReadCardinal(t.Text) is not null))
            {
                return null; // no sign named, or a whole sentence before the verb: not sure which words are the sign
            }

            var end = v;
            if (v + 1 < tokens.Count && tokens[v + 1].Clause == clause && tokens[v + 1].Text == "की")
            {
                end = v + 1;
            }

            signs.Add(new SpokenTimer(ScheduleTimerKind.Sign, null, null, null,
                string.Join(' ', signTokens.Select(t => t.Text)),
                words[signTokens[0].Start..tokens[end].End]));
        }

        return signs.Count == 1 ? signs[0] : null;
    }

    // ---- reading words ----------------------------------------------------------------------------------------------

    private static List<Token> Tokenize(string text)
    {
        var tokens = new List<Token>();
        var start = -1;
        var clause = 0;
        for (var i = 0; i <= text.Length; i++)
        {
            var c = i < text.Length ? text[i] : ' ';
            // a '.' or ',' between two digits belongs to the number ("8.5"), it is not the end of a sentence
            var insideNumber = (c is '.' or ',') && i > 0 && i + 1 < text.Length && char.IsDigit(text[i - 1]) && char.IsDigit(text[i + 1]);
            var separator = !insideNumber && (char.IsWhiteSpace(c) || char.IsPunctuation(c) || char.IsSymbol(c));
            if (separator)
            {
                if (start >= 0)
                {
                    tokens.Add(new Token(text[start..i], start, i, clause));
                    start = -1;
                }

                if (c is ',' or '.' or ';' or '।' or '!' or '?' or '\n' or ':' or '|')
                {
                    clause++;
                }
            }
            else if (start < 0)
            {
                start = i;
            }
        }

        return tokens;
    }

    private static int? ReadCardinal(string token)
    {
        if (TryDigits(token, out var digits))
        {
            return digits is >= 0 and <= ScheduleTaskTiming.MaxDay ? digits : null;
        }

        return Cardinals.TryGetValue(token, out var n) ? n : null;
    }

    private static int? ReadOrdinal(string token)
    {
        if (Ordinals.TryGetValue(token, out var n))
        {
            return n;
        }

        foreach (var suffix in new[] { "व्या", "वा" })
        {
            if (token.EndsWith(suffix, StringComparison.Ordinal) && TryDigits(token[..^suffix.Length], out var digits))
            {
                return digits;
            }
        }

        return null;
    }

    /// <summary>Latin or Devanagari digits only (a mix of the two, or a decimal, is not a whole number we are sure of).</summary>
    private static bool TryDigits(string token, out int value)
    {
        value = 0;
        if (token.Length is 0 or > 5)
        {
            return false;
        }

        var latin = token.All(c => c is >= '0' and <= '9');
        var devanagari = token.All(c => c is >= '०' and <= '९');
        if (!latin && !devanagari)
        {
            return false;
        }

        foreach (var c in token)
        {
            value = (value * 10) + (latin ? c - '0' : c - '०');
        }

        return true;
    }

    private static Dictionary<string, int> BuildCardinals()
    {
        var d = new Dictionary<string, int>(StringComparer.Ordinal);
        void Add(int n, params string[] forms)
        {
            foreach (var f in forms)
            {
                d[f] = n;
            }
        }

        Add(1, "एक"); Add(2, "दोन"); Add(3, "तीन"); Add(4, "चार"); Add(5, "पाच"); Add(6, "सहा"); Add(7, "सात"); Add(8, "आठ"); Add(9, "नऊ", "नउ");
        Add(10, "दहा"); Add(11, "अकरा"); Add(12, "बारा"); Add(13, "तेरा"); Add(14, "चौदा"); Add(15, "पंधरा"); Add(16, "सोळा"); Add(17, "सतरा");
        Add(18, "अठरा"); Add(19, "एकोणीस", "एकोनीस"); Add(20, "वीस"); Add(21, "एकवीस"); Add(22, "बावीस"); Add(23, "तेवीस"); Add(24, "चोवीस");
        Add(25, "पंचवीस"); Add(26, "सव्वीस"); Add(27, "सत्तावीस"); Add(28, "अठ्ठावीस", "अठ्ठाविस", "अठावीस"); Add(29, "एकोणतीस", "एकोनतीस");
        Add(30, "तीस"); Add(31, "एकतीस"); Add(32, "बत्तीस"); Add(33, "तेहतीस", "तेहेतीस"); Add(34, "चौतीस"); Add(35, "पस्तीस"); Add(36, "छत्तीस");
        Add(37, "सदतीस"); Add(38, "अडतीस"); Add(39, "एकोणचाळीस", "एकोनचाळीस"); Add(40, "चाळीस"); Add(41, "एक्केचाळीस", "एकेचाळीस");
        Add(42, "बेचाळीस"); Add(43, "त्रेचाळीस", "तेचाळीस"); Add(44, "चव्वेचाळीस", "चौर्‍याचाळीस"); Add(45, "पंचेचाळीस"); Add(46, "सेहेचाळीस", "सेहचाळीस");
        Add(47, "सत्तेचाळीस"); Add(48, "अठ्ठेचाळीस", "अठेचाळीस"); Add(49, "एकोणपन्नास", "एकोनपन्नास"); Add(50, "पन्नास"); Add(51, "एक्कावन्न", "एकावन्न");
        Add(52, "बावन्न"); Add(53, "त्रेपन्न"); Add(54, "चोपन्न"); Add(55, "पंचावन्न"); Add(56, "छप्पन्न"); Add(57, "सत्तावन्न"); Add(58, "अठ्ठावन्न", "अठावन्न");
        Add(59, "एकोणसाठ", "एकोनसाठ"); Add(60, "साठ");
        return d;
    }

    private static Dictionary<string, int> BuildOrdinals(Dictionary<string, int> cardinals)
    {
        var d = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["पहिल्या"] = 1,
            ["दुसऱ्या"] = 2,
            ["तिसऱ्या"] = 3,
            ["चौथ्या"] = 4,
            ["नवव्या"] = 9,
        };
        foreach (var (word, n) in cardinals)
        {
            if (n < 5 || n == 9)
            {
                continue; // 1-4 and 9 are irregular and listed above
            }

            d.TryAdd(word + "व्या", n);
            d.TryAdd(word + "ाव्या", n);
            if (word.EndsWith("स", StringComparison.Ordinal) && word.Length > 2 && word[^2] == 'ी')
            {
                d.TryAdd(string.Concat(word.AsSpan(0, word.Length - 2), "िस", "ाव्या"), n); // वीस -> विसाव्या
            }
        }

        return d;
    }
}
