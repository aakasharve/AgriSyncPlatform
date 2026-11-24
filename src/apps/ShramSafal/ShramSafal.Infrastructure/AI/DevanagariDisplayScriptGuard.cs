using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// spec: voice-flow-v2-2026-11-23 - display text in the transcript's script. A Marathi transcript shown with a Latin
/// "urea" in a title or summary reads as a mistake. When the transcript is mostly Devanagari, known Latin farm loanwords in
/// the DISPLAY fields (<c>summary</c>, <c>observations[].textCleaned</c>, task <c>title</c> / <c>rawText</c> on
/// <c>extractedTasks</c> and <c>plannedTasks</c>) become their Devanagari form. <c>sourceText</c> and <c>textRaw</c> are his
/// words exactly as heard and are never changed; an English or mostly-Latin transcript is untouched. Digits and unknown words
/// are left as they are.
/// </summary>
internal static partial class DevanagariDisplayScriptGuard
{
    internal static readonly IReadOnlyDictionary<string, string> Loanwords = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["urea"] = "युरिया",
        ["dap"] = "डीएपी",
        ["potash"] = "पोटॅश",
        ["sulphur"] = "सल्फर",
        ["sulfur"] = "सल्फर",
        ["zinc"] = "झिंक",
        ["calcium"] = "कॅल्शियम",
        ["magnesium"] = "मॅग्नेशियम",
        ["boron"] = "बोरॉन",
        ["humic"] = "ह्युमिक",
        ["dormex"] = "डॉर्मेक्स",
        ["trichoderma"] = "ट्रायकोडर्मा",
        ["bordeaux"] = "बोर्डो",
        ["board"] = "बोर्ड",
        ["spray"] = "स्प्रे",
        ["drip"] = "ठिबक",
        ["tank"] = "टँक",
        ["pump"] = "पंप",
        ["motor"] = "मोटर",
        ["tractor"] = "ट्रॅक्टर",
        ["labour"] = "मजूर",
        ["fungicide"] = "बुरशीनाशक",
        ["pesticide"] = "कीटकनाशक",
        ["fertilizer"] = "खत",
        ["mancozeb"] = "मॅन्कोझेब",
    };

    public static void Apply(JsonObject root)
    {
        var transcript = root["fullTranscript"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : string.Empty;
        if (!IsMostlyDevanagari(transcript))
        {
            return;
        }

        Convert(root, "summary");

        if (root["observations"] is JsonArray observations)
        {
            foreach (var node in observations.OfType<JsonObject>())
            {
                Convert(node, "textCleaned");
                ConvertTasks(node["extractedTasks"] as JsonArray);
            }
        }

        ConvertTasks(root["plannedTasks"] as JsonArray);
    }

    internal static bool IsMostlyDevanagari(string text)
    {
        var devanagari = 0;
        var latin = 0;
        foreach (var c in text)
        {
            if (c is >= 'ऀ' and <= 'ॿ')
            {
                devanagari++;
            }
            else if (c is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z'))
            {
                latin++;
            }
        }

        return devanagari > 0 && devanagari > latin;
    }

    internal static string ConvertText(string text) =>
        LatinWord().Replace(text, m => Loanwords.TryGetValue(m.Value, out var dev) ? dev : m.Value);

    private static void ConvertTasks(JsonArray? tasks)
    {
        if (tasks is null)
        {
            return;
        }

        foreach (var task in tasks.OfType<JsonObject>())
        {
            Convert(task, "title");
            Convert(task, "rawText");
        }
    }

    private static void Convert(JsonObject node, string key)
    {
        if (node[key] is JsonValue value && value.TryGetValue<string>(out var text) && !string.IsNullOrEmpty(text))
        {
            var converted = ConvertText(text);
            if (converted != text)
            {
                node[key] = converted;
            }
        }
    }

    // A whole Latin word (letters only), so a grade or a code with digits is not cut.
    [GeneratedRegex(@"(?<![A-Za-z0-9])[A-Za-z]+(?![A-Za-z0-9])")]
    private static partial Regex LatinWord();
}
