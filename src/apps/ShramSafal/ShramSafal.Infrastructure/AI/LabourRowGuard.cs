using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// PLR go-live register F22 + F23 (lane AI-1) — a deterministic guard on the model's labour rows, run on
/// EVERY voice parse (Gemini and Sarvam) after the model and before anything is stored. A prompt is guidance;
/// this is the guarantee.
///
/// <para><b>F22 — a crowd word is not a name.</b> "5 बायका आणि 2 पुरुष छाटणीला होते" is seven people, five
/// women and two men. The prompt's attendance rule ("count the names") read बायका and पुरुष as two workers
/// with those names, and the server's ledger derivation turns <c>workerNames</c> into worker identities. So a
/// crowd word — बायका / बाया / महिला / स्त्रिया / पुरुष / गडी / माणसं / मजूर / लोक / जण and their English
/// equivalents, bare or with a number or case ending — is removed from <c>workerNames</c> (and <c>whoWorked</c>,
/// and a <c>notes</c> that only repeated the names). Its gender becomes the row's <c>gender</c>; the number
/// spoken beside it becomes the row's per-gender count (the established "५ बायका" shape: count 5 AND
/// femaleCount 5). A total the farmer did not say is never added: "5 बायका आणि 2 पुरुष" keeps femaleCount 5
/// and maleCount 2 and NO count, and the app's own headcount rule reads the split (doctrine P7 / P4).</para>
///
/// <para><b>F23 — 0 is not a count.</b> A labour row is work people did; the model writes <c>count: 0</c> when
/// it did not understand how many. Zero counts are removed (not stated). "Nobody came" is not a labour row —
/// the prompt files it as an observation ("आज labour आला नाही" few-shot); a row the model built from it (a zero
/// and a "नाही" in its own words, nothing else stated) becomes exactly that observation, so the fact survives.</para>
///
/// <para>Removed, never set to null: the client schema reads these fields as <c>z.number().optional()</c>,
/// which rejects null.</para>
/// </summary>
internal static partial class LabourRowGuard
{
    private enum Crowd
    {
        Neutral,
        Female,
        Male
    }

    // Every form of a crowd word that can stand where a name stands: bare, plural, oblique, with the
    // agentive/dative endings (-नी / -ना) the model copies from the sentence. Latin forms are lower-case.
    // Deliberately NOT here: relationship words used as a name (काका, मामा, दादा, भाऊ, बाई) — the farmer means one
    // known person by them (prompt: ATTENDANCE IS A RECORD).
    private static readonly Dictionary<string, Crowd> CrowdWords = BuildCrowdWords();

    private static readonly HashSet<string> Connectors = new(StringComparer.Ordinal)
    {
        "आणि", "व", "अन्", "and", "ani", "&", "+"
    };

    private static readonly Dictionary<string, int> NumberWords = new(StringComparer.Ordinal)
    {
        ["एक"] = 1,
        ["दोन"] = 2,
        ["तीन"] = 3,
        ["चार"] = 4,
        ["पाच"] = 5,
        ["सहा"] = 6,
        ["सात"] = 7,
        ["आठ"] = 8,
        ["नऊ"] = 9,
        ["दहा"] = 10,
        ["अकरा"] = 11,
        ["बारा"] = 12,
        ["तेरा"] = 13,
        ["चौदा"] = 14,
        ["पंधरा"] = 15,
        ["सोळा"] = 16,
        ["सतरा"] = 17,
        ["अठरा"] = 18,
        ["एकोणीस"] = 19,
        ["वीस"] = 20,
        ["पंचवीस"] = 25,
        ["तीस"] = 30,
        ["one"] = 1,
        ["two"] = 2,
        ["three"] = 3,
        ["four"] = 4,
        ["five"] = 5,
        ["six"] = 6,
        ["seven"] = 7,
        ["eight"] = 8,
        ["nine"] = 9,
        ["ten"] = 10,
        ["twelve"] = 12,
        ["fifteen"] = 15,
        ["twenty"] = 20
    };

    // Words that make a row's own phrase say nobody came ("आज कोणी आलं नाही", "labour आला नाही").
    private static readonly string[] NobodyMarkers =
    [
        "नाही", "नाहीत", "नव्हते", "नव्हता", "नव्हती", "नव्हतं", "नव्हत्या", "गैरहजर", "कोणीच",
        "nobody", "absent", "nahi"
    ];

    // A row that states anything besides a (zero) count is real labour, never turned into a note.
    private static readonly string[] OtherFacts =
    [
        "hours", "durationHours", "totalCost", "wagePerPerson", "rate", "contractQuantity"
    ];

    public static void Apply(JsonObject root)
    {
        if (root["labour"] is not JsonArray labour)
        {
            return;
        }

        var notes = new List<JsonObject>();
        for (var i = labour.Count - 1; i >= 0; i--)
        {
            if (labour[i] is not JsonObject row)
            {
                continue;
            }

            var crowd = StripCrowdNames(row);
            ApplyCrowdCounts(row, crowd);
            var hadZero = RemoveZeroCounts(row);
            if (hadZero && SaysNobodyCame(row))
            {
                notes.Insert(0, NobodyNote(row));
                labour.RemoveAt(i);
            }
        }

        if (notes.Count == 0)
        {
            return;
        }

        if (root["observations"] is not JsonArray observations)
        {
            observations = [];
            root["observations"] = observations;
        }

        foreach (var note in notes)
        {
            observations.Add(note);
        }
    }

    /// <summary>
    /// Is this name only a crowd ("बायका", "5 बायका", "बायका आणि पुरुष", "workers")? A real name ("संतू",
    /// "सुमन बाई", "काका") is not. Exposed for the tests.
    /// </summary>
    internal static bool IsCrowdLabel(string? name) => CrowdOf(name) is not null;

    private sealed record CrowdFound(HashSet<Crowd> Genders, int ListedNames, bool Stripped, bool NamesLeft, string LabelText);

    private static CrowdFound StripCrowdNames(JsonObject row)
    {
        var genders = new HashSet<Crowd>();
        var labels = new List<string>();
        var listed = 0;
        var stripped = false;
        var namesLeft = false;

        foreach (var key in new[] { "workerNames", "whoWorked" })
        {
            if (row[key] is not JsonArray names)
            {
                continue;
            }

            listed = Math.Max(listed, names.Count);
            var keep = new JsonArray();
            foreach (var node in names)
            {
                var name = node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
                var crowd = CrowdOf(name);
                if (crowd is null)
                {
                    keep.Add(node?.DeepClone());
                    continue;
                }

                stripped = true;
                labels.Add(name!);
                genders.UnionWith(crowd);
            }

            namesLeft |= keep.Count > 0;
            if (keep.Count == 0)
            {
                row.Remove(key);
            }
            else if (keep.Count != names.Count)
            {
                row[key] = keep;
            }
        }

        // notes carries "the same names comma separated" (prompt). Drop the crowd words from it too; a note
        // that was only crowd words goes.
        if (row["notes"] is JsonValue notesValue && notesValue.TryGetValue<string>(out var notesText) &&
            !string.IsNullOrWhiteSpace(notesText))
        {
            var parts = NotesSplit().Split(notesText).Select(p => p.Trim()).Where(p => p.Length > 0).ToList();
            var crowdParts = parts.Where(p => CrowdOf(p) is not null).ToList();
            if (crowdParts.Count > 0 && (stripped || crowdParts.Count == parts.Count))
            {
                foreach (var part in crowdParts)
                {
                    genders.UnionWith(CrowdOf(part)!);
                    labels.Add(part);
                }

                stripped = true;
                listed = Math.Max(listed, parts.Count);
                var rest = parts.Where(p => CrowdOf(p) is null).ToList();
                if (rest.Count == 0)
                {
                    row.Remove("notes");
                }
                else
                {
                    row["notes"] = string.Join(", ", rest);
                }
            }
        }

        genders.Remove(Crowd.Neutral);
        return new CrowdFound(genders, listed, stripped, namesLeft, string.Join(" ", labels));
    }

    private static void ApplyCrowdCounts(JsonObject row, CrowdFound crowd)
    {
        var said = ReadString(row["sourceText"]) + " " + crowd.LabelText;
        var spoken = SpokenCrowdNumbers(said);
        int? female = spoken.TryGetValue(Crowd.Female, out var f) && f.Count == 1 ? f.First() : null;
        int? male = spoken.TryGetValue(Crowd.Male, out var m) && m.Count == 1 ? m.First() : null;
        var count = ReadNumber(row["count"]);
        var hasSplit = ReadNumber(row["maleCount"]) is > 0 || ReadNumber(row["femaleCount"]) is > 0;

        if (crowd.Stripped)
        {
            // The model counted the crowd words as people ("बायका" → 1). With no number spoken beside a crowd
            // word, that tally is not a count he said.
            if (count is not null && count == crowd.ListedNames && spoken.Count == 0)
            {
                row.Remove("count");
                count = null;
            }

            // Real names are still on the row (संतू, काका and "1 बायका"): the crowd is only part of it, so its
            // gender and number are not the row's.
            if (crowd.NamesLeft)
            {
                return;
            }

            if (crowd.Genders.Count > 0 && ReadString(row["gender"]).Length == 0)
            {
                row["gender"] = GenderOf(crowd.Genders);
            }

            if (hasSplit)
            {
                return;
            }

            if (crowd.Genders.SetEquals([Crowd.Female]))
            {
                SetSingleGender(row, "femaleCount", female, count);
            }
            else if (crowd.Genders.SetEquals([Crowd.Male]))
            {
                SetSingleGender(row, "maleCount", male, count);
            }
            else if (crowd.Genders.Count == 2 && female is not null && male is not null)
            {
                SetBothGenders(row, female.Value, male.Value, count, said);
            }

            return;
        }

        // No crowd word was listed as a name. Only tie a gender the row's OWN number already matches, so two
        // rows that share one long phrase are never both given the whole split.
        if (hasSplit || count is not { } stated || ReadString(row["gender"]).Length > 0)
        {
            return;
        }

        if (female is not null && male is not null && stated == female + male)
        {
            SetBothGenders(row, female.Value, male.Value, count, said);
        }
        else if (female == stated && male != stated)
        {
            row["femaleCount"] = stated;
            row["gender"] = "female";
        }
        else if (male == stated && female != stated)
        {
            row["maleCount"] = stated;
            row["gender"] = "male";
        }
    }

    private static void SetSingleGender(JsonObject row, string splitKey, int? spokenNumber, int? count)
    {
        if (spokenNumber is { } n && (count is null || count == n))
        {
            row[splitKey] = n;
            row["count"] = n;
        }
        else if (spokenNumber is null && count is { } c and > 0)
        {
            row[splitKey] = c;
        }
    }

    private static void SetBothGenders(JsonObject row, int female, int male, int? count, string said)
    {
        row["femaleCount"] = female;
        row["maleCount"] = male;
        row["gender"] = "mixed";
        // A total stays only when he said it himself; the app's headcount rule reads the split otherwise.
        if (count is not null && !(count == female + male && SaysNumber(said, female + male)))
        {
            row.Remove("count");
        }
    }

    private static bool RemoveZeroCounts(JsonObject row)
    {
        var hadZero = false;
        foreach (var key in new[] { "count", "maleCount", "femaleCount" })
        {
            if (row.ContainsKey(key) && ReadNumber(row[key]) is 0)
            {
                row.Remove(key);
                hadZero = true;
            }
        }

        return hadZero;
    }

    private static bool SaysNobodyCame(JsonObject row)
    {
        if (row.ContainsKey("count") || row.ContainsKey("maleCount") || row.ContainsKey("femaleCount") ||
            row["workerNames"] is JsonArray { Count: > 0 } ||
            OtherFacts.Any(k => ReadNumber(row[k]) is > 0))
        {
            return false;
        }

        var tokens = Tokens(ReadString(row["sourceText"]));
        return tokens.Any(t => NobodyMarkers.Contains(t, StringComparer.Ordinal)) ||
               ReadString(row["sourceText"]).Contains("no one", StringComparison.OrdinalIgnoreCase);
    }

    private static JsonObject NobodyNote(JsonObject row)
    {
        var phrase = ReadString(row["sourceText"]).Trim();
        return new JsonObject
        {
            ["noteType"] = "observation",
            ["textRaw"] = phrase,
            ["textCleaned"] = phrase,
            ["sourceText"] = phrase
        };
    }

    /// <summary>The crowd genders a label stands for; null when it is not only a crowd (a real name).</summary>
    private static HashSet<Crowd>? CrowdOf(string? label)
    {
        var tokens = Tokens(label);
        if (tokens.Count == 0)
        {
            return null;
        }

        var genders = new HashSet<Crowd>();
        foreach (var token in tokens)
        {
            if (CrowdWords.TryGetValue(token, out var crowd))
            {
                genders.Add(crowd);
            }
            else if (!Connectors.Contains(token) && NumberOf(token) is null)
            {
                return null;
            }
        }

        return genders.Count == 0 ? null : genders;
    }

    /// <summary>"5 बायका आणि 2 पुरुष" → female {5}, male {2}: each number spoken right before a crowd word.</summary>
    private static Dictionary<Crowd, HashSet<int>> SpokenCrowdNumbers(string text)
    {
        var tokens = Tokens(text);
        var found = new Dictionary<Crowd, HashSet<int>>();
        for (var i = 0; i + 1 < tokens.Count; i++)
        {
            if (NumberOf(tokens[i]) is not { } n || !CrowdWords.TryGetValue(tokens[i + 1], out var crowd))
            {
                continue;
            }

            if (!found.TryGetValue(crowd, out var set))
            {
                set = [];
                found[crowd] = set;
            }

            set.Add(n);
        }

        // Neutral numbers stay in: "1 मजूर" is a count he said, so the name-tally rule must not drop it.
        return found;
    }

    private static bool SaysNumber(string text, int number) => Tokens(text).Any(t => NumberOf(t) == number);

    private static string GenderOf(HashSet<Crowd> genders) =>
        genders.Count == 2 ? "mixed" : genders.Contains(Crowd.Female) ? "female" : "male";

    private static List<string> Tokens(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        // "5बायका" → "5 बायका"; keep Devanagari vowel signs (category M) inside words.
        var spaced = DigitLetterBoundary().Replace(text, "$1 $2");
        return TokenSplit().Split(spaced)
            .Where(t => t.Length > 0)
            .Select(t => t.ToLowerInvariant())
            .ToList();
    }

    private static int? NumberOf(string token)
    {
        if (NumberWords.TryGetValue(token, out var word))
        {
            return word;
        }

        if (!token.All(char.IsDigit))
        {
            return null;
        }

        var value = 0;
        foreach (var ch in token)
        {
            var digit = (int)char.GetNumericValue(ch);
            if (digit < 0 || value > 100_000)
            {
                return null;
            }

            value = (value * 10) + digit;
        }

        return value;
    }

    private static int? ReadNumber(JsonNode? node)
    {
        if (node is not JsonValue value)
        {
            return null;
        }

        if (value.TryGetValue<int>(out var i))
        {
            return i;
        }

        if (value.TryGetValue<double>(out var d) && Math.Abs(d - Math.Round(d)) < 1e-9)
        {
            return (int)Math.Round(d);
        }

        if (value.TryGetValue<decimal>(out var m) && m == decimal.Truncate(m))
        {
            return (int)m;
        }

        return value.TryGetValue<string>(out var s) &&
               int.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static string ReadString(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var s) ? s : string.Empty;

    private static Dictionary<string, Crowd> BuildCrowdWords()
    {
        var words = new Dictionary<string, Crowd>(StringComparer.Ordinal);
        void Add(Crowd crowd, params string[] forms)
        {
            foreach (var form in forms)
            {
                words[form] = crowd;
            }
        }

        Add(Crowd.Female,
            "बायका", "बायकां", "बायकांनी", "बायकांना", "बाया", "बायां", "बायांनी", "बायांना",
            "महिला", "महिलां", "महिलांनी", "महिलांना", "स्त्रिया", "स्त्री", "स्त्रियां", "स्त्रियांनी", "स्त्रियांना",
            "जणी", "जणींनी", "जणींना",
            "women", "woman", "ladies", "lady", "female", "females", "bayka", "baika", "baya", "mahila");
        Add(Crowd.Male,
            "पुरुष", "पुरुषां", "पुरुषांनी", "पुरुषांना", "गडी", "गड्यां", "गड्यांनी", "गड्यांना",
            "men", "man", "male", "males", "gents", "purush", "gadi");
        Add(Crowd.Neutral,
            "माणसं", "माणसे", "माणूस", "माणसां", "माणसांनी", "माणसांना",
            "मजूर", "मजुर", "मजूरं", "मजुरां", "मजूरां", "मजुरांनी", "मजूरांनी", "मजुरांना", "मजूरांना",
            "लोक", "लोकं", "लोकां", "लोकांनी", "लोकांना", "जण", "जणं", "जणां", "जणांनी", "जणांना",
            "कामगार", "कामगारां", "कामगारांनी", "कामगारांना", "लेबर", "लेबर्स",
            "labour", "labor", "labours", "labourer", "labourers", "laborer", "laborers", "worker", "workers",
            "people", "person", "persons", "majur", "majoor", "lok", "manse", "jan", "kamgar");
        return words;
    }

    [GeneratedRegex(@"(\p{Nd})(\p{L})")]
    private static partial Regex DigitLetterBoundary();

    [GeneratedRegex(@"[^\p{L}\p{M}\p{Nd}&+]+")]
    private static partial Regex TokenSplit();

    [GeneratedRegex(@"\s*(?:,|،|/|\bआणि\b|\band\b)\s*")]
    private static partial Regex NotesSplit();
}
