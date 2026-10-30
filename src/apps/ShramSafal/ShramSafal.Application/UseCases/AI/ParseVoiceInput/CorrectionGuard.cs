using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

/// <summary>
/// PLR lane AI-2 fix passes — a deterministic guard on a "बदला" parse, run ONLY when the phone sent the entry being
/// changed (<c>correctionOf</c>). The prompt asks the model to copy what he did not change; this makes sure of it,
/// whatever shape the model's answer takes.
///
/// <para>Live 2026-10-31 (real Sarvam, with the correction context; first run, then again after the first guard):</para>
/// <list type="bullet">
///   <item>"इथरेल 350 नाही, 400 मिली" → 400 ml, but the product came back "Ethrel" (rawProductName "इथरेल");</item>
///   <item>"पाणी 2 तास नव्हतं, 3 तास दिलं" → 3 h, but the method turned Flood, a row note "reduced from 2h" (English,
///   copied from a few-shot), and an observation that was his whole sentence;</item>
///   <item>"5 बायका नाही, 6 बायका होत्या" → 6, but an activity "weeding", then "unknown";</item>
///   <item>"बाविस्टीन नव्हतं, साफ मारलं होतं" → no input at all (and an ISSUE note "बाविस्टीन नव्हतं").</item>
/// </list>
/// <para>So, for a correction:</para>
/// <list type="bullet">
///   <item>(a) the answer row that corrects an entry row keeps every field of the entry row he did not say otherwise —
///   method, unit, gender, …; the SAME product keeps the entry's own name and spelling (same raw name, a spelling
///   variant, or a known name pair: "Ethrel" / "इथरेल"). A row is matched to the entry row by identity, name, the
///   number he negated, or — the entry and the answer each holding one row in that part — simply as that row;</item>
///   <item>(b) no observation / issue / unclear note / planned work (and no stoppage) is kept when it is made of the
///   correction: its text is the negated half ("X नाही / नव्हतं / नव्हते / ऐवजी / नको"), the whole correction
///   sentence or mostly its words, or it states both the old and the new number;</item>
///   <item>(c) a product swap ("X नव्हतं, Y मारलं होतं" / "X ऐवजी Y") is the X row with the product as he said Y,
///   everything else kept — built from the entry when the model answered no such row;</item>
///   <item>(d) a field the entry row does not have is kept only when his words say its value; a placeholder
///   ("unknown", "n/a", "none", …) and a row note he did not say are never stored.</item>
/// </list>
/// Every other bucket is left exactly as the model answered (a genuinely new condition he states stays a note).
/// </summary>
public static partial class CorrectionGuard
{
    private static readonly string[] NegationMarkers = ["नव्हतं", "नव्हते", "नव्हता", "नव्हती", "नव्हत्या", "नव्हतो", "नाही", "ऐवजी", "नको"];

    private static readonly string[] CorrectedBuckets = ["cropActivities", "irrigation", "labour", "inputs", "machinery", "activityExpenses"];

    private static readonly string[] NoteBuckets = ["observations", "unclearSegments", "plannedTasks"];

    private static readonly string[] NoteTextFields = ["textRaw", "textCleaned", "sourceText", "rawText", "title", "text", "note", "reason", "impact"];

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

    /// <summary>Values that say "not known" — never stored for a field he did not fill.</summary>
    private static readonly HashSet<string> Placeholders = new(StringComparer.OrdinalIgnoreCase)
    {
        "", "unknown", "n/a", "na", "none", "null", "nil", "-", "--", "?", "not specified", "not mentioned",
        "unspecified", "not stated", "not said", "अज्ञात", "माहित नाही"
    };

    /// <summary>Words that say a value without being it (what he would say for an enum or unit the parse writes in
    /// English), and names that are the same product in two scripts. Every word of a group stands for the group.</summary>
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
        ["ethrel", "इथरेल", "इथ्रेल", "एथरेल"],
        ["bavistin", "बाविस्टीन", "बावीस्टिन", "बाविस्टिन"],
        ["saaf", "saf", "साफ"],
        ["rally gold", "रॅली गोल्ड"],
        ["dormex", "डॉर्मेक्स"],
        ["urea", "युरिया"],
    ];

    /// <summary>Words of a said product phrase that are not the product ("साफ मारलं होतं" → "साफ").</summary>
    private static readonly HashSet<string> NotAName = new(StringComparer.Ordinal)
    {
        "मारलं", "मारले", "मारला", "मारली", "फवारलं", "फवारले", "फवारला", "फवारली", "फवारणी", "दिलं", "दिले", "दिला",
        "दिली", "टाकलं", "टाकले", "टाकला", "टाकली", "वापरलं", "वापरले", "वापरला", "वापरली", "घातलं", "घातले", "घेतलं",
        "होतं", "होते", "होता", "होती", "आहे", "केलं", "केले", "केला", "आज", "ते", "तो", "ती", "पण", "आणि", "ने", "नी",
        "मिली", "ml", "लिटर", "किलो", "kg", "ग्रॅम", "ग्राम", "g", "तास", "was", "is", "it", "used", "sprayed",
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
        ["साठ"] = 60,
        ["सत्तर"] = 70,
        ["पंचाहत्तर"] = 75,
        ["ऐंशी"] = 80,
        ["नव्वद"] = 90,
        ["शंभर"] = 100,
        ["दीडशे"] = 150,
        ["अडीचशे"] = 250,
    };

    /// <summary>A correction he said: what was negated (X), what he said instead (Y), and its whole sentence.</summary>
    internal sealed record Pair(string Negated, string Said, string Sentence);

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
        RemoveCorrectionNotes(answer, pairs, words);
        foreach (var bucket in CorrectedBuckets)
        {
            if (saved[bucket] is JsonArray savedRows && savedRows.Count > 0)
            {
                GuardBucket(answer, bucket, savedRows, pairs, words);
            }

            CleanUnmatchedRows(answer, bucket, saved, words);
        }

        System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
            "correction_guard.applied",
            tags: new System.Diagnostics.ActivityTagsCollection { ["pairs"] = pairs.Count }));
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
                    pairs.Add(new Pair(negated, said, sentence.Trim()));
                }

                break;
            }
        }

        return pairs;
    }

    /// <summary>Is the negated half about the entry (a value, a name it holds, or the part's own word)? "पाऊस आला
    /// नाही, …" is not.</summary>
    private static bool TouchesEntry(string negated, JsonObject saved)
    {
        var numbers = NumbersIn(negated);
        foreach (var bucket in CorrectedBuckets)
        {
            if (saved[bucket] is not JsonArray rows || rows.Count == 0)
            {
                continue;
            }

            if ((bucket == "irrigation" && Says(negated, "irrigation")) ||
                (bucket == "labour" && (Says(negated, "female") || Says(negated, "male") || negated.Contains("मजूर", StringComparison.Ordinal))))
            {
                return true;
            }

            foreach (var row in rows.OfType<JsonObject>())
            {
                if (NamesOf(bucket, row).Any(name => Mentions(negated, name)) ||
                    row.Any(p => p.Value is JsonValue v && v.TryGetValue<decimal>(out var n) && numbers.Contains(n)))
                {
                    return true;
                }
            }
        }

        return false;
    }

    // ------------------------------------------------------------------ (b) no note made of the correction

    private static void RemoveCorrectionNotes(JsonObject answer, List<Pair> pairs, string words)
    {
        if (pairs.Count == 0)
        {
            return;
        }

        var correctionSentences = pairs.Select(p => p.Sentence).ToHashSet(StringComparer.Ordinal);
        var otherSentences = SentenceSplit().Split(words)
            .Select(s => s.Trim())
            .Where(s => s.Length > 0 && !correctionSentences.Contains(s))
            .ToList();

        bool MadeOfCorrection(string? text)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return false;
            }

            // The negated half ("पाणी 2 तास नव्हतं").
            if (NegationMarkers.Any(m => text.Contains(m, StringComparison.Ordinal)) && pairs.Any(p => Mentions(text, p.Negated)))
            {
                return true;
            }

            // His correction sentence, or mostly its words. (Only the correction sentences: a new condition he states
            // in the same breath — "पानांवर डाग दिसले" — is not made of the correction and stays a note, and so does a
            // note closer to another sentence he said, "उद्या पण पाणी 3 तास द्यायचं".)
            var toCorrection = pairs.Max(p => Overlap(text, p.Sentence));
            var toOther = otherSentences.Select(s => Overlap(text, s)).DefaultIfEmpty(0).Max();
            if (toCorrection >= 0.6 && toCorrection > toOther)
            {
                return true;
            }

            // A paraphrase stating the old AND the new number ("Water was 3 hours, not 2").
            var numbers = NumbersIn(text);
            return pairs.Any(p =>
                NumbersIn(p.Negated).Any(numbers.Contains) && NumbersIn(p.Said).Any(numbers.Contains));
        }

        foreach (var bucket in NoteBuckets)
        {
            if (answer[bucket] is not JsonArray notes)
            {
                continue;
            }

            for (var i = notes.Count - 1; i >= 0; i--)
            {
                if (notes[i] is JsonObject note && NoteTextFields.Any(k => MadeOfCorrection(Text(note[k]))))
                {
                    notes.RemoveAt(i);
                }
            }
        }

        if (answer["disturbance"] is JsonObject disturbance && NoteTextFields.Any(k => MadeOfCorrection(Text(disturbance[k]))))
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
                answer[bucket] = new JsonArray(savedRows.Select(r => ReferenceEquals(r, s.Row) ? Swapped(s.Row, s.Name) : r?.DeepClone()).ToArray());
            }

            return;
        }

        var swapApplied = false;
        var answerRows = rows.OfType<JsonObject>().ToList();
        foreach (var row in answerRows)
        {
            var match = MatchRow(bucket, row, savedRows, pairs, swap, answerRows.Count);
            if (match is null)
            {
                continue;
            }

            if (swap is { } s && ReferenceEquals(match, s.Row))
            {
                if (swapApplied)
                {
                    // The X row again (the model kept it beside the swapped one): he said X was NOT used.
                    rows.Remove(row);
                    continue;
                }

                var swapped = Swapped(s.Row, s.Name);
                foreach (var key in Bookkeeping.Where(row.ContainsKey))
                {
                    swapped[key] = row[key]?.DeepClone();
                }

                rows[rows.IndexOf(row)] = swapped;
                swapApplied = true;
                continue;
            }

            KeepUnsaid(bucket, row, match, words);
        }

        // (c) the swap he said, and no answer row was about either product: the swapped X row joins the part.
        if (swap is { } missing && !swapApplied)
        {
            rows.Add(Swapped(missing.Row, missing.Name));
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
            if (current is null || IsPlaceholder(current))
            {
                row[key] = savedValue.DeepClone();
                continue;
            }

            if (JsonNode.DeepEquals(current, savedValue))
            {
                continue;
            }

            // The same product keeps the entry's own name and spelling; a value that only says the same thing another
            // way ("मिली" for the entry's "ml") keeps the entry's too.
            var sameMeaning = Text(current) is { } now && Text(savedValue) is { } before && Same(before, now);
            var keepNew = !names.Contains(key) && !sameMeaning && Said(current, words);
            if (!keepNew)
            {
                row[key] = savedValue.DeepClone();
            }
        }

        // (d) a field the entry row does not have: only when his words say its value (never a placeholder).
        foreach (var key in row.Select(p => p.Key).ToList())
        {
            if (Bookkeeping.Contains(key) || saved.ContainsKey(key))
            {
                continue;
            }

            if (names.Contains(key))
            {
                // A second name for the same product (rawProductName beside productName) stays only if he said it.
                if (IsPlaceholder(row[key]) || !Said(row[key], words))
                {
                    row.Remove(key);
                }

                continue;
            }

            if (IsPlaceholder(row[key]) || !Said(row[key], words))
            {
                row.Remove(key);
            }
        }
    }

    /// <summary>(d) for a row that corrects no entry row: never a placeholder, never a row note he did not say.</summary>
    private static void CleanUnmatchedRows(JsonObject answer, string bucket, JsonObject saved, string words)
    {
        if (answer[bucket] is not JsonArray rows)
        {
            return;
        }

        var savedNotes = saved[bucket] is JsonArray savedRows
            ? savedRows.OfType<JsonObject>().Select(r => Text(r["notes"])).Where(t => t is not null).ToHashSet(StringComparer.Ordinal)
            : [];
        foreach (var row in rows.OfType<JsonObject>())
        {
            foreach (var key in row.Select(p => p.Key).ToList())
            {
                if (Bookkeeping.Contains(key))
                {
                    continue;
                }

                if (IsPlaceholder(row[key]) ||
                    (key == "notes" && Text(row[key]) is { } note && !savedNotes.Contains(note) && !Said(row[key], words)))
                {
                    row.Remove(key);
                }
            }
        }
    }

    private static JsonObject? MatchRow(
        string bucket,
        JsonObject row,
        JsonArray savedRows,
        List<Pair> pairs,
        (JsonObject Row, string Name)? swap,
        int answerRows)
    {
        var candidates = savedRows.OfType<JsonObject>().ToList();
        if (swap is { } s && NamesOf(bucket, row).Any(name => SameName(name, s.Name)))
        {
            return s.Row;
        }

        if (bucket == "labour")
        {
            var gender = Text(row["gender"]);
            var type = Text(row["type"]);
            var byIdentity = candidates.Where(c =>
                (gender is null || IsPlaceholder(row["gender"]) || Text(c["gender"]) == gender) &&
                (type is null || Text(c["type"]) == type)).ToList();
            if (byIdentity.Count == 1)
            {
                return byIdentity[0];
            }
        }

        var byName = candidates.Where(c => NamesOf(bucket, c).Any(saved => NamesOf(bucket, row).Any(said => SameName(saved, said)))).ToList();
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

        // The entry holds one row in this part and the answer one: on the "बदला" screen that row is the one he changed.
        if (candidates.Count == 1 && (answerRows == 1 || pairs.Count > 0) &&
            (NamesOf(bucket, row).All(name => NamesOf(bucket, candidates[0]).Any(saved => SameName(saved, name))) || !NamesOf(bucket, row).Any()))
        {
            return candidates[0];
        }

        return null;
    }

    /// <summary>A swap: the negated half names an entry input, the said half names something else.</summary>
    private static (JsonObject Row, string Name)? FindSwap(JsonArray savedRows, List<Pair> pairs)
    {
        foreach (var pair in pairs)
        {
            var row = savedRows.OfType<JsonObject>().FirstOrDefault(r => NamesOf("inputs", r).Any(name => Mentions(pair.Negated, name)));
            if (row is null)
            {
                continue;
            }

            var name = NameIn(pair.Said);
            if (name.Length > 0 && !NamesOf("inputs", row).Any(existing => SameName(existing, name)))
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

    // ------------------------------------------------------------------ "did he say it?" / "is it the same?"

    private static bool IsPlaceholder(JsonNode? value) =>
        value is JsonValue v && v.TryGetValue<string>(out var s) && Placeholders.Contains(s.Trim());

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
                return Says(words, text) || (NumbersIn(text) is { Count: > 0 } said && said.All(NumbersIn(words).Contains) && Tokens(text).Count == 1);
            }

            return false;
        }

        // A list or an object is "said" only if every text in it is.
        var texts = value is null ? [] : Texts(value).ToList();
        return texts.Count > 0 && texts.All(t => Says(words, t));
    }

    private static bool Says(string words, string value)
    {
        if (string.IsNullOrWhiteSpace(value) || Placeholders.Contains(value.Trim()))
        {
            return false;
        }

        if (Mentions(words, value))
        {
            return true;
        }

        var key = value.Trim().ToLowerInvariant();
        return SameMeaning.Where(group => group.Contains(key, StringComparer.OrdinalIgnoreCase))
            .SelectMany(group => group)
            .Any(word => Mentions(words, word));
    }

    /// <summary>Two values that mean the same: equal, a known pair ("ml" / "मिली", "Ethrel" / "इथरेल").</summary>
    private static bool Same(string a, string b)
    {
        if (string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var key = a.Trim().ToLowerInvariant();
        return SameMeaning.Any(group => group.Contains(key, StringComparer.OrdinalIgnoreCase) && group.Contains(b.Trim(), StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>The same product or work: equal, a known pair, or the same letters with only the vowel signs spelled
    /// differently ("बाविस्टीन" / "बावीस्टिन").</summary>
    private static bool SameName(string a, string b) =>
        Same(a, b) || (Skeleton(a) is { Length: >= 2 } sa && sa == Skeleton(b));

    /// <summary>Does the text name it (as written, or in another vowel spelling)?</summary>
    private static bool Mentions(string text, string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0)
        {
            return false;
        }

        if (text.Contains(trimmed, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var skeleton = Skeleton(trimmed);
        return skeleton.Length >= 3 && Skeleton(text).Contains(skeleton, StringComparison.Ordinal);
    }

    /// <summary>
    /// A name's letters without vowel signs, virama, nukta or nasal marks (Devanagari), lower-case letters and digits
    /// otherwise — the part of a name a speech-to-text spelling keeps.
    /// </summary>
    private static string Skeleton(string text)
    {
        var builder = new StringBuilder(text.Length);
        foreach (var ch in text.Normalize(NormalizationForm.FormD))
        {
            if (ch is (>= '\u0900' and <= '\u0903') or (>= '\u093A' and <= '\u094F') or '\u093C' or '\u200C' or '\u200D' or (>= '\u0962' and <= '\u0963'))
            {
                continue; // nasal marks, vowel signs, virama, nukta, joiners
            }

            if (char.IsLetterOrDigit(ch))
            {
                builder.Append(char.ToLowerInvariant(ch));
            }
        }

        return builder.ToString();
    }

    /// <summary>The share of the text's words that are also words of the other text.</summary>
    private static double Overlap(string text, string other)
    {
        var mine = Tokens(text);
        if (mine.Count == 0)
        {
            return 0;
        }

        var theirs = Tokens(other).ToHashSet(StringComparer.Ordinal);
        return mine.Count(theirs.Contains) / (double)mine.Count;
    }

    /// <summary>The words as compared: spelling-tolerant, and a number the same whether said "तीन", "३" or "3".</summary>
    private static List<string> Tokens(string text) =>
        Words().Matches(text)
            .Select(m => NumbersIn(m.Value) is { Count: 1 } one && !m.Value.Any(char.IsLetter)
                ? one.First().ToString(CultureInfo.InvariantCulture)
                : NumberWord(m.Value) is { } word ? word.ToString(CultureInfo.InvariantCulture) : Skeleton(m.Value))
            .Where(t => t.Length > 0)
            .ToList();

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
            if (Text(row[key]) is { Length: > 0 } name && !Placeholders.Contains(name.Trim()))
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

        // Number words, with "तीनशे पन्नास" read as ONE number (350), not 300 and 50.
        var words = text.Split([' ', ',', '.', '।'], StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < words.Length; i++)
        {
            if (NumberWord(words[i]) is not { } n)
            {
                continue;
            }

            if (n >= 100 && n % 100 == 0 && i + 1 < words.Length && NumberWord(words[i + 1]) is { } rest and < 100)
            {
                n += rest;
                i++;
            }

            numbers.Add(n);
        }

        return numbers;
    }

    /// <summary>A Marathi number word: "पाच", "पन्नास", and the hundreds "तीनशे" / "साडेतीनशे".</summary>
    private static decimal? NumberWord(string word)
    {
        if (NumberWords.TryGetValue(word, out var n))
        {
            return n;
        }

        if (word.EndsWith("शे", StringComparison.Ordinal))
        {
            var head = word[..^2];
            var half = head.StartsWith("साडे", StringComparison.Ordinal);
            if (half)
            {
                head = head["साडे".Length..];
            }

            if (NumberWords.TryGetValue(head, out var hundreds) && hundreds < 10)
            {
                return (hundreds + (half ? 0.5m : 0m)) * 100;
            }
        }

        return null;
    }

    private static string? Text(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    // A full stop ends a sentence only before a space or the end — "2.5 लिटर" is one number.
    [GeneratedRegex(@"[।?!\n]+|\.(?=\s|$)")]
    private static partial Regex SentenceSplit();

    [GeneratedRegex(@"\d+(?:\.\d+)?")]
    private static partial Regex Digits();

    [GeneratedRegex(@"[\p{L}\p{M}\p{N}]+")]
    private static partial Regex Words();
}
