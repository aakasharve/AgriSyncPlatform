using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// spec: voice-flow-v2-2026-11-23 - the summary must not carry the speech-to-text digit string of a fertilizer grade.
/// "05234 चं खत" was recognised as grade "0-52-34" (<c>inputs[].productName</c>), yet the summary kept "05234". The raw digits
/// of an input's recognised grade are replaced in <c>summary</c> by the grade as the row carries it. No word is added and no
/// other text is changed.
/// </summary>
internal static partial class SummaryGradeArtefactGuard
{
    public static void Apply(JsonObject root)
    {
        if (root["summary"] is not JsonValue sv || !sv.TryGetValue<string>(out var summary) || string.IsNullOrWhiteSpace(summary) ||
            root["inputs"] is not JsonArray inputs)
        {
            return;
        }

        var result = summary;
        foreach (var row in inputs.OfType<JsonObject>())
        {
            var name = ReadString(row["productName"]);
            if (name.Length == 0)
            {
                name = ReadString(row["normalizedProductName"]);
            }

            var grade = Grade().Match(name);
            if (!grade.Success)
            {
                continue;
            }

            var n = grade.Groups[1].Value;
            var p = grade.Groups[2].Value;
            var k = grade.Groups[3].Value;
            var replacement = grade.Value.Trim();
            var spoken = new[] { n + p + k, n.PadLeft(2, '0') + p.PadLeft(2, '0') + k.PadLeft(2, '0') }.Distinct();
            foreach (var digits in spoken)
            {
                result = Regex.Replace(result, $@"(?<!\d){digits}(?!\d)", replacement);
            }
        }

        if (result != summary)
        {
            root["summary"] = result;
        }
    }

    private static string ReadString(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var s) ? s.Trim() : string.Empty;

    [GeneratedRegex(@"^\s*(\d{1,2})[-:](\d{1,2})[-:](\d{1,2})(?!\d)")]
    private static partial Regex Grade();
}
