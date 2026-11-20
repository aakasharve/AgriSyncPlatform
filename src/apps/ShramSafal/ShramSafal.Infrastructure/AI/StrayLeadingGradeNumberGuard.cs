using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// PLR lane AI-PARSE-FIX - a stray number in front of a fertilizer grade. The founder's real log said "ते बघ मग 2 19 19 19 5 kg आणि
/// Calcium Nitrate 3 kg सोडलं": speech-to-text put a stray "2" in front of the grade 19-19-19, and the model kept the whole run as one
/// product named "2-19-19-19" (the prompt's rule is to keep what was said). Nothing in the app knows a grade "2-19-19-19".
///
/// <para>When a product name is FOUR numbers and the LAST THREE are a grade the shared <see cref="NpkGradeTable"/> knows, the row gets a
/// <c>didYouMean</c> tag: what was heard (kept, unchanged), the grade it may have been, and the stray number. The model's name is NOT
/// rewritten and the "2" is NOT dropped: it might be a count ("2 bags") or a mis-hearing, and only the farmer knows. The quantity, the
/// unit and the words are never touched (P7, P8). If the last three are not a known grade, nothing is tagged: the guard never
/// invents a grade (P4).</para>
///
/// <para>The tag is a plain extra key on the product row (the phone's nested schemas pass unknown keys through, P11). It is the
/// server's half of the question; the "did you mean" answer on the phone (lane FACTS-2) is where the farmer is asked.</para>
/// </summary>
internal static partial class StrayLeadingGradeNumberGuard
{
    public const string TagKey = "didYouMean";
    public const string Kind = "stray-leading-number";

    public static void Apply(JsonObject root)
    {
        if (root["inputs"] is not JsonArray inputs)
        {
            return;
        }

        foreach (var node in inputs)
        {
            if (node is not JsonObject input)
            {
                continue;
            }

            Tag(input);
            if (input["mix"] is JsonArray mix)
            {
                foreach (var item in mix.OfType<JsonObject>())
                {
                    Tag(item);
                }
            }
        }
    }

    private static void Tag(JsonObject row)
    {
        if (row[TagKey] is not null || row["productName"] is not JsonValue value || !value.TryGetValue<string>(out var heard))
        {
            return;
        }

        if (Parse(heard) is not { } parts)
        {
            return;
        }

        var grade = $"{parts[1]}-{parts[2]}-{parts[3]}";
        if (!NpkGradeTable.KnownGrades.ContainsKey(grade))
        {
            return;
        }

        row[TagKey] = new JsonObject
        {
            ["kind"] = Kind,
            ["heard"] = heard,
            ["suggested"] = grade,
            ["strayNumber"] = parts[0].ToString(CultureInfo.InvariantCulture),
        };
    }

    /// <summary>The four numbers of a name made of exactly four numbers, in any digit script; otherwise null.</summary>
    private static int[]? Parse(string name)
    {
        var match = FourNumbers().Match(name);
        if (!match.Success)
        {
            return null;
        }

        var numbers = new int[4];
        for (var i = 0; i < 4; i++)
        {
            var digits = match.Groups[i + 1].Value;
            var value = 0;
            foreach (var c in digits)
            {
                value = value * 10 + CharUnicodeInfo.GetDecimalDigitValue(c);
            }

            numbers[i] = value;
        }

        return numbers;
    }

    [GeneratedRegex(@"^\s*(\d{1,2})\s*[-:–.\s]\s*(\d{1,2})\s*[-:–.\s]\s*(\d{1,2})\s*[-:–.\s]\s*(\d{1,2})\s*$")]
    private static partial Regex FourNumbers();
}
