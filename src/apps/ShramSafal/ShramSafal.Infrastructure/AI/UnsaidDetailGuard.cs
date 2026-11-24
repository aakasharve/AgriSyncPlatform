using System.Text.Json.Nodes;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// spec: voice-flow-v2-2026-11-23 - a method, activity or detail the farmer did not say is not shown to him as said.
/// Real answer 2026-11-24: "नेहमीप्रमाणे पाणी दिलं" came back as irrigation method "Flood"; "05234 चं खत दिलं" as input method
/// "Soil"; "आज 10 जण आली होती" as labour activity "fertilizer_application". Each was the model's guess.
///
/// <para>The row's OWN <c>sourceText</c> must carry a word that supports the field, or the field is removed (the key is removed,
/// never set to null: the phone's schema reads these as optional strings). Labour: the activity stays only when the row's
/// words name a task. Irrigation / inputs: the method stays only when the row's words carry a word for that method. Everything
/// else on the row is untouched.</para>
/// </summary>
internal static class UnsaidDetailGuard
{
    private static readonly string[] FloodWords = ["पाट", "flood"];
    private static readonly string[] DripWords = ["ठिबक", "drip"];
    private static readonly string[] SprinklerWords = ["तुषार", "स्प्रिंकलर", "sprinkler", "rain gun", "रेन गन"];
    private static readonly string[] SprayWords = ["फवार", "spray", "स्प्रे", "पंप", "pump", "मारल", "मारून"];
    private static readonly string[] DrenchWords = ["ड्रेंच", "drench", "आळवण", "आळवल"];
    private static readonly string[] SoilWords = ["जमिनीत", "मातीत", "टाकल", "टाकून", "soil", "बेसल", "basal"];
    private static readonly string[] PasteWords = ["पेस्ट", "paste", "लावल", "लावून"];
    private static readonly string[] FertigationWords = ["ठिबक", "फर्टिगेशन", "fertigation", "drip"];

    // A task word: what people DO in a vineyard. A head count alone ("आज 10 जण आली होती") names none.
    private static readonly string[] TaskWords =
    [
        "खत", "टाकल", "टाकत", "फवार", "स्प्रे", "छाट", "खुरप", "निंद", "पाणी", "पाट", "सोड",
        "तोड", "काढ", "कापणी", "कापल", "वेचणी", "बांध", "शेंडा", "मारल", "मारत", "लावल", "लावत", "लागवड",
        "नांगर", "मशागत", "भरणी", "भरल", "औषध", "पेस्ट", "डिंक", "डोळे", "फूट", "पॅकिंग", "पॅक", "धुतल", "साफ", "सफाई", "वाहतूक",
        "मळणी", "झाडल", "ठिबक", "सिंचन", "कळ्या", "विरळणी", "गिबरेलिक", "काम",
        "spray", "prun", "weed", "irrigat", "fertili", "harvest", "tying", "plant", "pack", "dig", "hoe", "thin", "trim", "cut",
        "pick", "load", "clean", "paste", "apply", "applied", "work"
    ];

    public static void Apply(JsonObject root)
    {
        DropUnsaidMethods(root["irrigation"] as JsonArray);
        DropUnsaidMethods(root["inputs"] as JsonArray);
        DropUnsaidActivity(root["labour"] as JsonArray);
    }

    /// <summary>Does the row's own phrase say this method? Exposed for the tests.</summary>
    internal static bool MethodIsSupported(string method, string sourceText)
    {
        var key = method.Trim().ToLowerInvariant();
        string[] words = key switch
        {
            "flood" => FloodWords,
            "drip" => DripWords,
            "sprinkler" => SprinklerWords,
            "spray" => SprayWords,
            "drenching" or "drench" => DrenchWords,
            "soil" => SoilWords,
            "paste_manual" or "paste" => PasteWords,
            "fertigation" => FertigationWords,
            _ => [key]
        };

        return ContainsAny(sourceText, words);
    }

    /// <summary>Do the row's words name a task? Exposed for the tests.</summary>
    internal static bool NamesATask(string sourceText) =>
        !string.IsNullOrWhiteSpace(sourceText) && ContainsAny(sourceText, TaskWords);

    private static void DropUnsaidMethods(JsonArray? rows)
    {
        if (rows is null)
        {
            return;
        }

        foreach (var node in rows)
        {
            if (node is not JsonObject row || !row.ContainsKey("method"))
            {
                continue;
            }

            // A row with no sourceText makes no claim about his words, so there is nothing to test it against (the
            // provenance check treats it the same way): it is left as it is.
            var said = ReadString(row["sourceText"]);
            var method = ReadString(row["method"]);
            if (said.Length > 0 && (method.Length == 0 || !MethodIsSupported(method, said)))
            {
                row.Remove("method");
            }
        }
    }

    private static void DropUnsaidActivity(JsonArray? labour)
    {
        if (labour is null)
        {
            return;
        }

        foreach (var node in labour)
        {
            if (node is JsonObject row && row.ContainsKey("activity") &&
                ReadString(row["sourceText"]).Length > 0 && !NamesATask(ReadString(row["sourceText"])))
            {
                row.Remove("activity");
            }
        }
    }

    private static bool ContainsAny(string text, string[] words) =>
        words.Any(w => text.Contains(w, StringComparison.OrdinalIgnoreCase));

    private static string ReadString(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var s) ? s.Trim() : string.Empty;
}
