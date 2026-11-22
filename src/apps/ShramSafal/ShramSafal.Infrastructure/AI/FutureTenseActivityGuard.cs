using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ShramSafal.Application.UseCases.Logs.Content;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// PLR lane AI-PARSE-FIX - a future task is not work done. The founder's real log (2026-11-20 23:08) said "... खालच्या पानांवर थोडी
/// भुरी दिसत आहे, त्यासाठी उद्या board तयार करायचा आहे आणि खुरपणी पण करायची आहे" (weeding is still to be done) and the model stored
/// weeding BOTH as a plannedTask and as a COMPLETED <c>cropActivities</c> row, so the day counted work nobody had done yet.
///
/// <para>When an activity's OWN words (its <c>sourceText</c>, the phrase the model says it extracted it from) are future tense and carry
/// no past-tense execution word, the item is tagged <see cref="PlannedOnlyMarker.Key"/> = true, and its <c>status</c> is set to
/// <c>pending</c> (a value every phone already parses) when the model gave none. Tagged, never deleted and never moved: a mechanical
/// check must not destroy what the model extracted (the provenance rule). A model's own explicit <c>status</c> is kept as it is.</para>
///
/// <para><b>Deliberately conservative.</b> A sentence that has BOTH a future form and a past execution word is left alone: "आज घड
/// बांधायचं काम झालं आणि शेंडा मारला" has "बांधायचं" (a future-looking form meaning "the work of tying") and "झालं" / "मारला", and it is work
/// done. An infinitive form ("...यचं", "...यची") counts as future only when "आहे" or "असेल" follows it (or it is the contracted "...यचंय"),
/// so a noun-like use is not read as intent. No future word, or any past word, means no tag: the guard only ever says "this is still to
/// do" when his words say so and nothing in them says it was done.</para>
/// </summary>
internal static partial class FutureTenseActivityGuard
{
    public static void Apply(JsonObject root)
    {
        if (root["cropActivities"] is not JsonArray activities)
        {
            return;
        }

        foreach (var node in activities)
        {
            if (node is not JsonObject activity ||
                activity[PlannedOnlyMarker.Key] is JsonValue existing && existing.TryGetValue<bool>(out var already) && already)
            {
                continue;
            }

            if (!IsFutureOnly(ReadString(activity["sourceText"])))
            {
                continue;
            }

            activity[PlannedOnlyMarker.Key] = true;
            if (ReadString(activity["status"]).Trim().Length == 0)
            {
                activity["status"] = "pending";
            }
        }
    }

    /// <summary>His words speak of work still to be done, and say nothing was done.</summary>
    internal static bool IsFutureOnly(string words)
    {
        if (string.IsNullOrWhiteSpace(words))
        {
            return false;
        }

        var tokens = TokenSplit().Split(words.ToLowerInvariant()).Where(t => t.Length > 0).ToArray();
        return HasFutureForm(tokens, words) && !HasPastForm(tokens);
    }

    private static bool HasFutureForm(string[] tokens, string words)
    {
        for (var i = 0; i < tokens.Length; i++)
        {
            var token = tokens[i];
            if (FutureWords.Contains(token))
            {
                return true;
            }

            // "करायची आहे", "करायचं आहे", "करायचा आहे": the obligation form followed by "आहे" / "असेल". Without it the form is not read as intent.
            if (ObligationSuffixes.Any(suffix => token.EndsWith(suffix, StringComparison.Ordinal)) && i + 1 < tokens.Length && ObligationAuxiliaries.Contains(tokens[i + 1]))
            {
                return true;
            }

            // The contracted "करायचंय", "करायचीय": the auxiliary is inside the word.
            if (ContractedObligationSuffixes.Any(suffix => token.EndsWith(suffix, StringComparison.Ordinal)))
            {
                return true;
            }
        }

        return EnglishFuturePhrase().IsMatch(words);
    }

    private static bool HasPastForm(string[] tokens) => tokens.Any(PastWords.Contains);

    private static string ReadString(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var s) ? s : string.Empty;

    // Words and suffixes are matched on whole tokens (letters, combining marks and digits), never on \b: .NET's \w leaves out the
    // Devanagari vowel signs, so a word boundary would cut a Marathi word in the middle.
    [GeneratedRegex(@"[^\p{L}\p{M}\p{Nd}]+")]
    private static partial Regex TokenSplit();

    [GeneratedRegex(@"\b(?:need to|needs to|have to|has to|going to|will)\b", RegexOptions.IgnoreCase)]
    private static partial Regex EnglishFuturePhrase();

    private static readonly HashSet<string> FutureWords = new(StringComparer.Ordinal)
    {
        // the prompt's own future words (AiPromptBuilder: "करायचं/द्यायचं/आणायचं/पाहिजे/उद्या") that stand on their own
        "उद्या", "पाहिजे", "पाहिजेत", "हवं", "हवे", "हवी", "हवा", "लागेल", "लागतील", "करणार", "करणारे",
        "tomorrow", "tmrw", "gonna",
    };

    private static readonly string[] ObligationSuffixes = ["ायचं", "ायचे", "ायची", "ायचा", "ायच्या"];

    private static readonly string[] ContractedObligationSuffixes = ["ायचंय", "ायचेय", "ायचीय", "ायचाय"];

    private static readonly HashSet<string> ObligationAuxiliaries = new(StringComparer.Ordinal)
    {
        "आहे", "आहेत", "असेल", "असतील",
    };

    // Common execution verbs, past tense, every gender and number the farmers' sentences use. "होतं" is here on purpose: "करायचं
    // होतं" is an intention that is already over, which this guard does not call "still to do".
    private static readonly HashSet<string> PastWords = new(StringComparer.Ordinal)
    {
        "केले", "केली", "केलं", "केला", "केल्या", "झाले", "झाली", "झालं", "झाला", "झाल्या",
        "दिले", "दिली", "दिलं", "दिला", "दिल्या", "वापरले", "वापरली", "वापरलं", "वापरला",
        "मारले", "मारली", "मारलं", "मारला", "टाकले", "टाकली", "टाकलं", "टाकला", "सोडले", "सोडली", "सोडलं", "सोडला",
        "फवारले", "फवारली", "फवारलं", "फवारला", "लावले", "लावली", "लावलं", "लावला", "बांधले", "बांधली", "बांधलं", "बांधला",
        "कापले", "कापली", "कापलं", "कापला", "काढले", "काढली", "काढलं", "काढला", "घेतले", "घेतली", "घेतलं", "घेतला",
        "चालले", "चालली", "चालला", "गेले", "गेली", "गेलं", "गेला", "आले", "आली", "आलं", "आला",
        "होते", "होती", "होतं", "होता", "उरकले", "उरकलं", "उरकली", "उरकला",
        "did", "done", "completed", "finished", "was", "were", "had", "applied", "sprayed",
    };
}
