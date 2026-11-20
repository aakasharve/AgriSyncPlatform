using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// PLR lane AI-PARSE-FIX - "board" can be Bordeaux mixture. A grape farmer who says "board मिश्रण फवारायचं" means बोर्डो मिश्रण (copper
/// sulphate and lime, the classic fungicide), and the model stored "बोर्ड तयार करणे" (prepare a board). But a farmer can also say a real
/// signboard: a bare "board" is NOT Bordeaux.
///
/// <para>The guard tags a row with a <c>didYouMean</c> suggestion ONLY when (1) the row's own words carry the bare word "board" / "बोर्ड"
/// (not "बोर्डो", "Bordeaux" or "Bordo", which are already the name) AND (2) the transcript sentence that word came from also carries a
/// spray, fungicide or mixture word (फवार*, spray, मिश्रण, mixture, बुरशीनाशक, fungicide, पेस्ट, paste). The farmer's word is kept as
/// <c>heard</c>; nothing is rewritten (P8) and no title, product name or quantity is changed. Where the transcript has more than one
/// "board" sentence and only some carry such a word, a row is tagged only when its own <c>sourceText</c> sits inside a sentence that
/// does; a row with no <c>sourceText</c> is then left alone. A disease word alone ("भुरी") is NOT such a word: it names the trouble, not the
/// spray, so a sentence with only "भुरी" and "board" is left untagged (that wider reading is a decision for the founder).</para>
///
/// <para>The tag is a plain extra key (the phone's nested schemas pass unknown keys through, P11); showing it as a suggestion the farmer
/// can accept is the phone's half.</para>
/// </summary>
internal static partial class BordeauxBoardGuard
{
    public const string TagKey = "didYouMean";
    public const string Kind = "bordeaux-mixture";

    private static readonly string[] Buckets = ["plannedTasks", "cropActivities", "inputs", "observations"];

    private static readonly string[] OwnWordKeys = ["title", "sourceText", "productName", "textRaw", "textCleaned"];

    public static void Apply(JsonObject root)
    {
        var transcript = root["fullTranscript"] is JsonValue value && value.TryGetValue<string>(out var t) ? t : string.Empty;
        if (string.IsNullOrWhiteSpace(transcript))
        {
            return;
        }

        var boardSentences = SentenceSplit().Split(transcript).Where(s => BareBoardWord(s) is not null).ToList();
        if (boardSentences.Count == 0)
        {
            return;
        }

        var mixtureSentences = boardSentences.Where(HasSprayWord).ToList();
        if (mixtureSentences.Count == 0)
        {
            return;
        }

        var everyBoardSentenceIsAMixture = mixtureSentences.Count == boardSentences.Count;

        foreach (var bucket in Buckets)
        {
            if (root[bucket] is not JsonArray rows)
            {
                continue;
            }

            foreach (var row in rows.OfType<JsonObject>())
            {
                if (row[TagKey] is not null)
                {
                    continue;
                }

                var heard = OwnWordKeys.Select(k => BareBoardWord(ReadString(row[k]))).FirstOrDefault(w => w is not null);
                if (heard is null || !(everyBoardSentenceIsAMixture || RowSitsInOneOf(row, mixtureSentences)))
                {
                    continue;
                }

                row[TagKey] = new JsonObject
                {
                    ["kind"] = Kind,
                    ["heard"] = heard,
                    ["suggested"] = new JsonObject
                    {
                        ["en"] = "Bordeaux mixture",
                        ["mr"] = "बोर्डो मिश्रण",
                    },
                };
            }
        }
    }

    /// <summary>The bare word "board" / "बोर्ड" as it appears in these words, or null. "बोर्डो" and "Bordeaux" are not it.</summary>
    internal static string? BareBoardWord(string words) =>
        TokenSplit().Split(words).FirstOrDefault(token =>
            string.Equals(token, "board", StringComparison.OrdinalIgnoreCase) || string.Equals(token, "बोर्ड", StringComparison.Ordinal));

    private static bool HasSprayWord(string sentence) =>
        TokenSplit().Split(sentence.ToLowerInvariant()).Any(token =>
            SprayStems.Any(stem => token.StartsWith(stem, StringComparison.Ordinal)));

    private static bool RowSitsInOneOf(JsonObject row, List<string> sentences)
    {
        var own = ReadString(row["sourceText"]).Trim();
        return own.Length > 0 && sentences.Any(s => s.Contains(own, StringComparison.Ordinal));
    }

    private static string ReadString(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var s) ? s : string.Empty;

    // A token STARTS with one of these (a Marathi word takes endings: फवारायचं, फवाऱ्याला, मिश्रणात).
    private static readonly string[] SprayStems =
    [
        "फवार", "फवा", "spray", "मिश्रण", "mixture", "mixing", "बुरशीनाशक", "fungicide", "पेस्ट", "paste",
    ];

    [GeneratedRegex(@"[.।!?\n]+")]
    private static partial Regex SentenceSplit();

    [GeneratedRegex(@"[^\p{L}\p{M}\p{Nd}]+")]
    private static partial Regex TokenSplit();
}
