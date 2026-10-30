using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

/// <summary>
/// PLR lane AI-2 fix pass — a deterministic guard on a "बदला" parse, run ONLY when the phone sent the entry being
/// changed (<c>correctionOf</c>). The prompt asks the model to copy what he did not change; this makes sure of it.
///
/// <para>Live 2026-10-31 (real Sarvam, with the correction context):</para>
/// <list type="bullet">
///   <item>"इथरेल 350 नाही, 400 मिली" → 400 ml, but the product came back "Ethrel", not the entry's "इथरेल";</item>
///   <item>"पाणी 2 तास नव्हतं, 3 तास दिलं" → 3 h, but the method turned Drip → Flood, plus a note "पाणी 2 तास नव्हतं";</item>
///   <item>"5 बायका नाही, 6 बायका होत्या" → 6, but an activity "weeding" nobody said;</item>
///   <item>"बाविस्टीन नव्हतं, साफ मारलं होतं" → no input at all, and an ISSUE note "बाविस्टीन नव्हतं".</item>
/// </list>
/// <para>So, for a correction:</para>
/// <list type="bullet">
///   <item>(a) the answer row that corrects an entry row keeps every field of the entry row he did not mention —
///   method, unit, the product name in the entry's own language and spelling, gender, …; a value differs from the
///   entry only when his words say the new value;</item>
///   <item>(b) no observation / issue / unclear note (and no stoppage) is made of the negated half of a correction
///   ("X नाही / नव्हतं / नव्हते / ऐवजी / नको, Y");</item>
///   <item>(c) a product swap ("X नव्हतं, Y होतं" / "X ऐवजी Y") is the X row with the product as he said Y,
///   everything else kept;</item>
///   <item>(d) a field the entry row does not have is kept only when his words say its value (never an invented
///   labour activity).</item>
/// </list>
/// A row that corrects nothing in the entry, and every other bucket, is left exactly as the model answered.
/// </summary>
public static partial class CorrectionGuard
{
    private static readonly string[] NegationMarkers = ["नव्हतं", "नव्हते", "नव्हता", "नव्हती", "नाही", "ऐवजी", "नको"];

    private static readonly string[] CorrectedBuckets = ["cropActivities", "irrigation", "labour", "inputs", "machinery", "activityExpenses"];

    private static readonly string[] NoteBuckets = ["observations", "unclearSegments", "plannedTasks"];

    /// <summary>The app's bookkeeping on a row: never compared, never removed.</summary>
    private static readonly HashSet<string> Bookkeeping = new(StringComparer.Ordinal)
    {
        "id", "sourceText", "systemInterpretation", "provenanceVerified", "provenance", "confidence", "numbers",
        "fieldConfidence", "fieldConfidences", "mixId", "passId"
    };

    /// <summary>The names a row is known by, per bucket.</summary>
    private static readonly Dictionary<string, string[]> NameFields = new(StringComparer.Ordinal)
    {
        ["inputs"] = ["productName", "rawProductName"],
        ["cropActivities"] = ["title"],
        ["machinery"] = ["name", "type"],
        ["activityExpenses"] = ["reason"],
    };

    /// <summary>Words that say a value without being it (what he would say for an enum or unit the parse writes in
    /// English). Every word of a group stands for the group.</summary>
    private static readonly string[][] SameMeaning =
    [
        ["drip", "ठिबक", "ड्रिप"],
        ["flood", "पाट", "पाटाने", "पाटानं", "मोकाट"],
        ["sprinkler", "स्प्रिंकलर", "तुषार"],
        ["spray", "फवारणी", "फवारलं", "फवारले", "फवारला"],
        ["drenching", "ड्रेंचिंग", "आळवणी"],
        ["fertigation", "फर्टिगेशन"],
        ["ml", "मिली", "मि.ली."],
        ["l", "लिटर", "लि."],
        ["kg", "किलो"],
        ["g", "ग्रॅम", "ग्राम"],
        ["female", "बायका", "बाया", "महिला", "स्त्रिया"],
        ["male", "पुरुष", "गडी", "माणसं"],
        ["weeding", "खुरपणी", "निंदणी"],
        ["pruning", "छाटणी"],
        ["spraying", "फवारणी"],
        ["harvest", "काढणी", "तोडणी"],
        ["irrigation", "पाणी"],
    ];

    /// <summary>Words of a said product phrase that are not the product ("साफ मारलं होतं" → "साफ").</summary>
    private static readonly HashSet<string> NotAName = new(StringComparer.Ordinal)
    {
        "मारलं", "मारले", "मारला", "मारली", "फवारलं", "फवारले", "फवारणी", "दिलं", "दिले", "दिला", "टाकलं", "टाकले",
        "वापरलं", "वापरले", "होतं", "होते", "होता", "होती", "आहे", "केलं", "केले", "आज", "ते", "तो", "ती", "पण", "आणि",
        "मिली", "ml", "लिटर", "किलो", "kg", "ग्रॅम", "ग्राम", "g", "तास", "was", "is", "it",
    };

    private static readonly Dictionary<string, decimal> NumberWords = new(StringComparer.Ordinal)
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
        ["पंधरा"] = 15,
        ["वीस"] = 20,
        ["पंचवीस"] = 25,
        ["तीस"] = 30,
        ["चाळीस"] = 40,
        ["पन्नास"] = 50,
        ["शंभर"] = 100,
    };

    /// <summary>A correction he said: what was negated (X), and what he said instead (Y).</summary>
    internal sealed record Pair(string Negated, string Said);

    /// <summary>
    /// The guarded answer. <paramref name="entry"/> is the entry as the phone sent it (<c>correctionOf</c>);
    /// <paramref name="words"/> what he said or typed. An answer that is not JSON is returned unchanged.
    /// </summary>
    public static string Apply(string answerJson, JsonElement entry, string words)
    {
        if (entry.ValueKind != JsonValueKind.Object || string.IsNullOrWhiteSpace(words) ||
            JsonNode.Parse(entry.GetRawText()) is not JsonObject saved)
        {
            return answerJson;
        }

        JsonObject answer;
        try
        {
            if (JsonNode.Parse(answerJson) is not JsonObject parsed)
            {
                return answerJson;
            }

            answer = parsed;
        }
        catch (JsonException)
        {
            // An answer that is not JSON goes on unchanged; the parse path reports it. Leave a trace that the guard stood aside.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("correction_guard.answer_not_json"));
            return answerJson;
        }

        var pairs = FindPairs(words).Where(p => TouchesEntry(p.Negated, saved)).ToList();
        RemoveNegatedNotes(answer, pairs);
        foreach (var bucket in CorrectedBuckets)
        {
            if (saved[bucket] is JsonArray savedRows && savedRows.Count > 0)
            {
                GuardBucket(answer, bucket, savedRows, pairs, words);
            }
        }

        return answer.ToJsonString();
    }

    // ------------------------------------------------------------------ the corrections he said

    /// <summary>"X नाही, Y" / "X नव्हतं, Y" / "X ऐवजी Y" … — only where something follows (a plain "नाही." ends a
    /// sentence, it corrects nothing).</summary>
    internal static List<Pair> FindPairs(string words)
    {
        var pairs = new List<Pair>();
        foreach (var sentence in SentenceSplit().Split(words))
        {
            foreach (var marker in NegationMarkers)
            {
                var at = sentence.IndexOf(marker, StringComparison.Ordinal);
                if (at <= 0)
                {
                    continue;
                }

                var before = sentence[..at];
                var lastComma = before.LastIndexOfAny([',', ';']);
                var negated = (lastComma >= 0 ? before[(lastComma + 1)..] : before).Trim(' ', ',', '.');
                var said = sentence[(at + marker.Length)..].Trim(' ', ',', '.', '।');
                if (negated.Length > 0 && said.Length > 0)
                {
                    pairs.Add(new Pair(negated, said));
                }

                break;
            }
        }

        return pairs;
    }

    /// <summary>Is the negated half about the entry (a value or a name it holds)? "पाऊस आला नाही, …" is not.</summary>
    private static bool TouchesEntry(string negated, JsonObject saved)
    {
        var numbers = NumbersIn(negated);
        foreach (var bucket in CorrectedBuckets)
        {
            if (saved[bucket] is not JsonArray rows)
            {
                continue;
            }

            if (bucket == "irrigation" && Says(negated, "irrigation"))
            {
                return true;
            }

            foreach (var row in rows.OfType<JsonObject>())
            {
                if (NamesOf(bucket, row).Any(name => Contains(negated, name)) ||
                    row.Any(p => p.Value is JsonValue v && v.TryGetValue<decimal>(out var n) && numbers.Contains(n)))
                {
                    return true;
                }
            }
        }

        return false;
    }

    // ------------------------------------------------------------------ (b) no note from the negated half

    private static void RemoveNegatedNotes(JsonObject answer, List<Pair> pairs)
    {
        if (pairs.Count == 0)
        {
            return;
        }

        bool MadeOfNegation(string? text) =>
            !string.IsNullOrWhiteSpace(text) &&
            NegationMarkers.Any(m => text.Contains(m, StringComparison.Ordinal)) &&
            pairs.Any(p => Contains(text, p.Negated));

        foreach (var bucket in NoteBuckets)
        {
            if (answer[bucket] is not JsonArray notes)
            {
                continue;
            }

            for (var i = notes.Count - 1; i >= 0; i--)
            {
                if (notes[i] is JsonObject note &&
                    new[] { "textRaw", "textCleaned", "sourceText", "rawText", "title", "text" }.Any(k => MadeOfNegation(Text(note[k]))))
                {
                    notes.RemoveAt(i);
                }
            }
        }

        if (answer["disturbance"] is JsonObject disturbance &&
            new[] { "note", "sourceText", "reason" }.Any(k => MadeOfNegation(Text(disturbance[k]))))
        {
            answer.Remove("disturbance");
        }
    }

    // ------------------------------------------------------------------ (a), (c), (d) per bucket

    private static void GuardBucket(JsonObject answer, string bucket, JsonArray savedRows, List<Pair> pairs, string words)
    {
        var swap = bucket == "inputs" ? FindSwap(savedRows, pairs) : null;
        if (answer[bucket] is not JsonArray rows || rows.Count == 0)
        {
            // (c) the swap he said, with no row in the answer: the X row with the product as he said it.
            if (swap is { } s)
            {
                var replaced = new JsonArray();
                foreach (var row in savedRows)
                {
                    replaced.Add(ReferenceEquals(row, s.Row) ? Swapped(s.Row, s.Name) : row?.DeepClone());
                }

                answer[bucket] = replaced;
            }

            return;
        }

        foreach (var row in rows.OfType<JsonObject>().ToList())
        {
            var match = MatchRow(bucket, row, savedRows, pairs, swap);
            if (match is null)
            {
                continue;
            }

            if (swap is { } s && ReferenceEquals(match, s.Row))
            {
                var swapped = Swapped(s.Row, s.Name);
                foreach (var key in Bookkeeping.Where(row.ContainsKey))
                {
                    swapped[key] = row[key]?.DeepClone();
                }

                rows[rows.IndexOf(row)] = swapped;
                continue;
            }

            KeepUnsaid(bucket, row, match, words);
        }
    }

    private static void KeepUnsaid(string bucket, JsonObject row, JsonObject saved, string words)
    {
        var names = NameFields.TryGetValue(bucket, out var n) ? n : [];

        // (a) every field of the entry row: kept, unless his words say the new value.
        foreach (var (key, savedValue) in saved)
        {
            if (Bookkeeping.Contains(key) || savedValue is null)
            {
                continue;
            }

            var current = row[key];
            if (current is null)
            {
                row[key] = savedValue.DeepClone();
                continue;
            }

            if (JsonNode.DeepEquals(current, savedValue))
            {
                continue;
            }

            // A name keeps the entry's own language and spelling (he did not change the product); so does a value
            // that only says the same thing another way ("मिली" for the entry's "ml").
            var sameMeaning = Text(current) is { } now && Text(savedValue) is { } before && Same(before, now);
            var keepNew = !names.Contains(key) && !sameMeaning && Said(current, words);
            if (!keepNew)
            {
                row[key] = savedValue.DeepClone();
            }
        }

        // (d) a field the entry row does not have: only when his words say its value.
        foreach (var key in row.Select(p => p.Key).ToList())
        {
            if (Bookkeeping.Contains(key) || saved.ContainsKey(key) || names.Contains(key))
            {
                continue;
            }

            if (!Said(row[key], words))
            {
                row.Remove(key);
            }
        }
    }

    private static JsonObject? MatchRow(string bucket, JsonObject row, JsonArray savedRows, List<Pair> pairs, (JsonObject Row, string Name)? swap)
    {
        var candidates = savedRows.OfType<JsonObject>().ToList();
        if (swap is { } s && NamesOf(bucket, row).Any(name => Contains(s.Name, name) || Contains(name, s.Name)))
        {
            return s.Row;
        }

        if (bucket == "labour")
        {
            var gender = Text(row["gender"]);
            var type = Text(row["type"]);
            var byIdentity = candidates.Where(c =>
                (gender is null || Text(c["gender"]) == gender) && (type is null || Text(c["type"]) == type)).ToList();
            if (byIdentity.Count == 1)
            {
                return byIdentity[0];
            }
        }

        var byName = candidates.Where(c => NamesOf(bucket, c).Any(saved => NamesOf(bucket, row).Any(said => Same(saved, said)))).ToList();
        if (byName.Count == 1)
        {
            return byName[0];
        }

        var negatedNumbers = pairs.SelectMany(p => NumbersIn(p.Negated)).ToHashSet();
        var byNumber = candidates.Where(c => c.Any(p => p.Value is JsonValue v && v.TryGetValue<decimal>(out var x) && negatedNumbers.Contains(x))).ToList();
        if (byNumber.Count == 1)
        {
            return byNumber[0];
        }

        return candidates.Count == 1 && pairs.Count > 0 ? candidates[0] : null;
    }

    /// <summary>A swap: the negated half names an entry input, the said half names something else.</summary>
    private static (JsonObject Row, string Name)? FindSwap(JsonArray savedRows, List<Pair> pairs)
    {
        foreach (var pair in pairs)
        {
            var row = savedRows.OfType<JsonObject>().FirstOrDefault(r => NamesOf("inputs", r).Any(name => Contains(pair.Negated, name)));
            if (row is null)
            {
                continue;
            }

            var name = NameIn(pair.Said);
            if (name.Length > 0 && !NamesOf("inputs", row).Any(existing => Same(existing, name)))
            {
                return (row, name);
            }
        }

        return null;
    }

    private static JsonObject Swapped(JsonObject saved, string name)
    {
        var copy = saved.DeepClone().AsObject();
        copy["productName"] = name;
        if (copy.ContainsKey("rawProductName"))
        {
            copy["rawProductName"] = name;
        }

        if (copy["mix"] is JsonArray mix && mix.Count == 1 && mix[0] is JsonObject only)
        {
            only["productName"] = name;
        }

        return copy;
    }

    /// <summary>The product in a said phrase: its words that are not numbers, units, verbs or helpers.</summary>
    private static string NameIn(string said) =>
        string.Join(" ", said.Split([' ', ','], StringSplitOptions.RemoveEmptyEntries)
            .Select(w => w.Trim('.', '।'))
            .Where(w => w.Length > 0 && !NotAName.Contains(w) && NumbersIn(w).Count == 0));

    // ------------------------------------------------------------------ "did he say it?"

    private static bool Said(JsonNode? value, string words)
    {
        if (value is JsonValue v)
        {
            if (v.TryGetValue<decimal>(out var number))
            {
                return NumbersIn(words).Contains(number);
            }

            if (v.TryGetValue<string>(out var text))
            {
                return Says(words, text);
            }

            return false;
        }

        // A list or an object is "said" only if every text in it is.
        return value is not null && value.ToJsonString().Length > 0 &&
               Texts(value).All(t => Says(words, t)) && Texts(value).Any();
    }

    private static bool Says(string words, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        if (Contains(words, value))
        {
            return true;
        }

        var key = value.Trim().ToLowerInvariant();
        return SameMeaning.Where(group => group.Contains(key, StringComparer.OrdinalIgnoreCase))
            .SelectMany(group => group)
            .Any(word => Contains(words, word));
    }

    private static bool Same(string a, string b)
    {
        if (string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var key = a.Trim().ToLowerInvariant();
        return SameMeaning.Any(group => group.Contains(key, StringComparer.OrdinalIgnoreCase) && group.Contains(b.Trim(), StringComparer.OrdinalIgnoreCase));
    }

    private static IEnumerable<string> Texts(JsonNode node) => node switch
    {
        JsonValue v when v.TryGetValue<string>(out var s) => [s],
        JsonArray a => a.Where(x => x is not null).SelectMany(x => Texts(x!)),
        JsonObject o => o.Where(p => p.Value is not null).SelectMany(p => Texts(p.Value!)),
        _ => [],
    };

    private static IEnumerable<string> NamesOf(string bucket, JsonObject row)
    {
        if (!NameFields.TryGetValue(bucket, out var keys))
        {
            yield break;
        }

        foreach (var key in keys)
        {
            if (Text(row[key]) is { Length: > 0 } name)
            {
                yield return name;
            }
        }

        if (row["mix"] is JsonArray mix)
        {
            foreach (var item in mix.OfType<JsonObject>())
            {
                if (Text(item["productName"]) is { Length: > 0 } name)
                {
                    yield return name;
                }
            }
        }
    }

    internal static HashSet<decimal> NumbersIn(string text)
    {
        var numbers = new HashSet<decimal>();
        var normalized = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            normalized.Append(ch is >= '०' and <= '९' ? (char)('0' + (ch - '०')) : ch);
        }

        foreach (Match m in Digits().Matches(normalized.ToString()))
        {
            if (decimal.TryParse(m.Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var n))
            {
                numbers.Add(n);
            }
        }

        foreach (var word in text.Split([' ', ',', '.', '।'], StringSplitOptions.RemoveEmptyEntries))
        {
            if (NumberWords.TryGetValue(word, out var n))
            {
                numbers.Add(n);
            }
        }

        return numbers;
    }

    private static bool Contains(string haystack, string needle) =>
        needle.Trim().Length > 0 && haystack.Contains(needle.Trim(), StringComparison.OrdinalIgnoreCase);

    private static string? Text(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    // A full stop ends a sentence only before a space or the end — "2.5 लिटर" is one number.
    [GeneratedRegex(@"[।?!\n]+|\.(?=\s|$)")]
    private static partial Regex SentenceSplit();

    [GeneratedRegex(@"\d+(?:\.\d+)?")]
    private static partial Regex Digits();
}
