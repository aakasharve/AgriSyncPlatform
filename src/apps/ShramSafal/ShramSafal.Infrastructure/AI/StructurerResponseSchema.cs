using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// 28 Nov 2026 (CTO scope add) — the response schema sent to Gemini for the sorting call, so the model's answer is ENFORCED
/// to be valid JSON of the right skeleton instead of merely asked for in the prompt (the 20-sample test ran without one, and
/// one 3.5 Flash-Lite answer carried a stray <c>- "femaleCount": 3</c> line that cost a whole labour row).
///
/// <para>
/// <b>What it fixes and what it leaves alone.</b> It fixes the skeleton only: the answer is an object, <c>dayOutcome</c> is
/// there and is one of the four values the app knows, and the eight row buckets are arrays of objects. The rows themselves
/// are OPEN objects (<c>additionalProperties: true</c>, no property list): every field the prompt asks a row to carry (
/// <c>mixId</c>, <c>carrierVolume</c>, <c>sourceText</c>, ...) still comes through, because a field this schema forgot to
/// name would be silently dropped by the model. The prompt text is not touched. Keys not named here (<c>summary</c>,
/// <c>disturbance</c>, <c>missingSegments</c>, <c>referenced_date</c>, ...) stay free for the same reason.
/// </para>
///
/// <para>
/// Sent only for a sorting prompt (one that asks for a <c>dayOutcome</c>); the verification prompt has its own, different
/// answer and gets none. Switchable with <c>Gemini:StructurerResponseSchema</c>.
/// </para>
/// </summary>
internal static class StructurerResponseSchema
{
    /// <summary>The eight buckets whose rows are objects in the prompt's own examples.</summary>
    private static readonly string[] RowBuckets =
    [
        "cropActivities", "irrigation", "labour", "inputs", "machinery", "activityExpenses", "observations", "plannedTasks"
    ];

    private static readonly Lazy<JsonElement> Cached = new(Build);

    public static JsonElement Json => Cached.Value;

    private static JsonElement Build()
    {
        var properties = new JsonObject
        {
            ["dayOutcome"] = new JsonObject
            {
                ["type"] = "string",
                ["enum"] = new JsonArray(AiResponseNormalizer.AllowedDayOutcomes.Order(StringComparer.Ordinal).Select(v => (JsonNode?)JsonValue.Create(v)).ToArray()),
            },
            ["summary"] = new JsonObject { ["type"] = "string" },
            ["confidence"] = new JsonObject { ["type"] = "number" },
        };

        foreach (var bucket in RowBuckets)
        {
            properties[bucket] = new JsonObject
            {
                ["type"] = "array",
                ["items"] = new JsonObject
                {
                    ["type"] = "object",
                    ["additionalProperties"] = true,
                },
            };
        }

        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = new JsonArray("dayOutcome"),
            ["additionalProperties"] = true,
        };

        return JsonSerializer.SerializeToElement(schema);
    }
}
