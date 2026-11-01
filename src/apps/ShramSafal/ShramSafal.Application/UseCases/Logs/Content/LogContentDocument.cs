using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShramSafal.Application.UseCases.Logs.Content;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — the server's reading of the
/// content document (<c>sync-contract/schemas/payloads/_log_content.zod.ts</c>): what Sathi
/// understood for one log, as the phone holds it.
///
/// <para><b>The server stores it, it does not interpret it.</b> Only the STRUCTURE is checked —
/// the same rules the zod schema enforces on the phone, so a payload that passed the phone's
/// enqueue also passes here: an object with the known keys only, <c>schema</c> = 1, each bucket an
/// array of objects with a string <c>id</c> (1–128 characters), the disturbance an object, his
/// whole words a string, and one size cap. Item fields beyond <c>id</c> are kept exactly as sent
/// (doctrine P8: his values, units, words and the verified flag are what we promised to keep).</para>
/// </summary>
public static class LogContentDocument
{
    /// <summary>The document format (<c>LOG_CONTENT_SCHEMA_VERSION</c>).</summary>
    public const int SchemaVersion = 1;

    /// <summary>The same cap as <c>LOG_CONTENT_MAX_BYTES</c> and the manual draft's.</summary>
    public const int MaxBytes = 64 * 1024;

    /// <summary><c>LOG_CONTENT_ITEM_ID_MAX</c>.</summary>
    public const int MaxItemIdLength = 128;

    /// <summary><c>LOG_CONTENT_TRANSCRIPT_MAX</c> (UTF-16 code units, as zod and C# both count).</summary>
    public const int MaxTranscriptLength = 20000;

    /// <summary>The <c>capturedAtUtc</c> bound in the zod schema.</summary>
    public const int MaxCapturedAtLength = 40;

    /// <summary>The seven item buckets (<c>LOG_CONTENT_BUCKETS</c>), in task-projection order.</summary>
    public static readonly IReadOnlyList<string> Buckets =
    [
        "cropActivities",
        "irrigation",
        "inputs",
        "observations",
        "machinery",
        "activityExpenses",
        "plannedTasks",
    ];

    /// <summary>
    /// His words — personal data under the notice (doctrine P6). Removed by account erasure, and
    /// sent only to the people allowed to hear them (founder D-31 / D-26, <c>RecordWordsGate</c>),
    /// wherever they sit in the document. Every free-text field the farmer says or types, walked
    /// field by field from <c>log.types.ts</c> and <c>observation.types.ts</c> (review S2):
    /// <list type="bullet">
    /// <item><c>fullTranscript</c> — his whole sentence (the document root);</item>
    /// <item><c>sourceText</c> — the phrase behind every item, issue and disturbance;</item>
    /// <item><c>spokenText</c> — the words behind each number (<c>numbers.*</c>);</item>
    /// <item><c>notes</c> — crop work, water, inputs, machinery and expense notes;</item>
    /// <item><c>note</c> — the note on a bucket issue and on the disturbance;</item>
    /// <item><c>impact</c> — the disturbance's impact, in his words;</item>
    /// <item><c>dueHint</c> — the spoken "when" of planned work;</item>
    /// <item><c>rawText</c> — the text that raised a task candidate under an observation;</item>
    /// <item><c>description</c> — a planned task's description (filled from <c>rawText</c>, the
    /// observation text or <c>dueHint</c>);</item>
    /// <item><c>systemInterpretation</c> — Sathi's restatement of his phrase, shown beside it.</item>
    /// </list>
    /// <para><b>Values, not words, and kept:</b> titles, product names, units, amounts, reasons
    /// (the disturbance and issue reason follow D-FREETEXT-PRESERVE-2026-06-29), vendor and
    /// recommender, and observation text (<c>textRaw</c> / <c>textCleaned</c>) — the observation
    /// IS its text, it already reaches every member on its task line, and it follows the existing
    /// D-FREETEXT-PRESERVE disposition (farm knowledge, kept), as <c>ssf.observation_events</c>
    /// does.</para>
    /// </summary>
    public static readonly IReadOnlySet<string> WordKeys = new HashSet<string>(StringComparer.Ordinal)
    {
        "fullTranscript",
        "sourceText",
        "spokenText",
        "notes",
        "note",
        "impact",
        "dueHint",
        "rawText",
        "description",
        "systemInterpretation",
    };

    /// <summary>
    /// lane MU-3 (founder D-22 / D-26) — the MONEY a record states: the amounts the server itself reads as
    /// a line's price (<c>RecordMoneyLines</c>: an input's <c>cost</c>, a machine's <c>rentalCost</c> and
    /// <c>fuelCost</c>, an expense's <c>totalAmount</c>), an expense item's <c>unitPrice</c> and
    /// <c>total</c>, and <c>totalCost</c>. Removed wherever they sit — the
    /// <c>numbers.&lt;field&gt;</c> fact behind each amount (with his spoken words for it) included — for a
    /// reader who may not see the farm's money and did not make the record himself; every other value
    /// stays. An edit by such a reader carries them forward (<see cref="CarryMoneyForward"/>), so their
    /// absence from his edit is never a deletion.
    /// </summary>
    public static readonly IReadOnlySet<string> MoneyKeys = new HashSet<string>(StringComparer.Ordinal)
    {
        "cost",
        "rentalCost",
        "fuelCost",
        "totalAmount",
        "unitPrice",
        "total",
        "totalCost",
    };

    private static readonly HashSet<string> BucketSet = new(Buckets, StringComparer.Ordinal);

    private static readonly HashSet<string> ScalarKeys = new(StringComparer.Ordinal)
    {
        "schema",
        "capturedAtUtc",
        "fullTranscript",
        "disturbance",
    };

    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        // Keep Devanagari readable in the stored text; jsonb normalises either way.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>
    /// The structural check. Returns <c>null</c> when the document is acceptable, otherwise the
    /// reason it is refused.
    /// </summary>
    public static string? Validate(JsonElement content)
    {
        if (content.ValueKind != JsonValueKind.Object)
        {
            return "content must be an object.";
        }

        if (Encoding.UTF8.GetByteCount(content.GetRawText()) > MaxBytes)
        {
            return $"content exceeds {MaxBytes} bytes.";
        }

        var sawSchema = false;
        foreach (var property in content.EnumerateObject())
        {
            var name = property.Name;
            var value = property.Value;

            if (BucketSet.Contains(name))
            {
                if (value.ValueKind == JsonValueKind.Null)
                {
                    continue;
                }

                if (value.ValueKind != JsonValueKind.Array)
                {
                    return $"content bucket '{name}' must be an array.";
                }

                // An item's id is how a later version names the SAME item (its task line, its
                // history), so two items in one bucket may not share one (review N2).
                var seenIds = new HashSet<string>(StringComparer.Ordinal);
                foreach (var item in value.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object
                        || !item.TryGetProperty("id", out var id)
                        || id.ValueKind != JsonValueKind.String
                        || id.GetString() is not { Length: >= 1 and <= MaxItemIdLength } itemId)
                    {
                        return $"every item in content bucket '{name}' must be an object with a string id of 1 to {MaxItemIdLength} characters.";
                    }

                    if (!seenIds.Add(itemId))
                    {
                        return $"content bucket '{name}' holds two items with the same id.";
                    }
                }

                continue;
            }

            if (!ScalarKeys.Contains(name))
            {
                return "content contains unsupported keys.";
            }

            switch (name)
            {
                case "schema":
                    if (value.ValueKind != JsonValueKind.Number
                        || !value.TryGetInt32(out var schema)
                        || schema != SchemaVersion)
                    {
                        return $"content schema must be {SchemaVersion}.";
                    }

                    sawSchema = true;
                    break;
                case "capturedAtUtc":
                    if (value.ValueKind is not (JsonValueKind.String or JsonValueKind.Null)
                        || (value.ValueKind == JsonValueKind.String && value.GetString()!.Length > MaxCapturedAtLength))
                    {
                        return "content capturedAtUtc must be a short string.";
                    }

                    break;
                case "fullTranscript":
                    if (value.ValueKind is not (JsonValueKind.String or JsonValueKind.Null)
                        || (value.ValueKind == JsonValueKind.String && value.GetString()!.Length > MaxTranscriptLength))
                    {
                        return $"content fullTranscript must be a string of at most {MaxTranscriptLength} characters.";
                    }

                    break;
                case "disturbance":
                    if (value.ValueKind is not (JsonValueKind.Object or JsonValueKind.Null))
                    {
                        return "content disturbance must be an object.";
                    }

                    break;
            }
        }

        return sawSchema ? null : $"content schema must be {SchemaVersion}.";
    }

    /// <summary>Whether a stored document and an incoming one say exactly the same thing.</summary>
    public static bool SameDocument(string storedJson, JsonElement incoming)
    {
        using var stored = JsonDocument.Parse(storedJson);
        return JsonElement.DeepEquals(stored.RootElement, incoming);
    }

    /// <summary>When the phone captured it (<c>capturedAtUtc</c>), if it said and it parses.</summary>
    public static DateTime? CapturedAtUtc(JsonElement content)
    {
        if (content.ValueKind == JsonValueKind.Object
            && content.TryGetProperty("capturedAtUtc", out var captured)
            && captured.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(
                captured.GetString(),
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal,
                out var at))
        {
            return at.UtcDateTime;
        }

        return null;
    }

    /// <summary>
    /// Account erasure: the document with every <see cref="WordKeys"/> property removed, at any
    /// depth. Values stay exactly as they were.
    /// </summary>
    public static string StripWords(string documentJson) => StripKeys(documentJson, WordKeys);

    /// <summary>
    /// lane MU-3 — the document with every <see cref="MoneyKeys"/> property removed, at any depth. Every
    /// other value (and his words) stays exactly as it was.
    /// </summary>
    public static string StripMoney(string documentJson) => StripKeys(documentJson, MoneyKeys);

    private static string StripKeys(string documentJson, IReadOnlySet<string> keys)
    {
        var root = JsonNode.Parse(documentJson);
        Strip(root, keys);
        return root?.ToJsonString(WriteOptions) ?? "{}";
    }

    /// <summary>
    /// A revision made by someone who may NOT hear the words (review S1): his phone was sent the
    /// document without them, so their absence from his edit is not a deletion. Every word the
    /// previous version held at a place his edit still has — the root, the same item (matched by
    /// its id), the same nested object — is carried onto his document. Everything he did write
    /// stays exactly as he wrote it, and an item he removed takes its words with it.
    /// </summary>
    public static string CarryWordsForward(string previousDocumentJson, string incomingDocumentJson) =>
        CarryKeysForward(previousDocumentJson, incomingDocumentJson, WordKeys);

    /// <summary>
    /// lane MU-3 — a revision made by someone who may NOT see the farm's money and did not make the
    /// record: his phone was sent the document without its amounts, so their absence from his edit is not
    /// a deletion. Every amount the previous version held at a place his edit still has is carried onto
    /// his document, exactly as <see cref="CarryWordsForward"/> carries the words; an item he removed
    /// takes its amounts with it.
    /// </summary>
    public static string CarryMoneyForward(string previousDocumentJson, string incomingDocumentJson) =>
        CarryKeysForward(previousDocumentJson, incomingDocumentJson, MoneyKeys);

    private static string CarryKeysForward(string previousDocumentJson, string incomingDocumentJson, IReadOnlySet<string> keys)
    {
        var previous = JsonNode.Parse(previousDocumentJson);
        var incoming = JsonNode.Parse(incomingDocumentJson);
        if (incoming is null)
        {
            return incomingDocumentJson;
        }

        Carry(previous, incoming, keys);
        return incoming.ToJsonString(WriteOptions);
    }

    /// <summary>
    /// An OLDER phone's manual save (1.0.15–1.0.17) carries its typed buckets as
    /// <c>manualDraft</c> — the very arrays that phone saved (<c>buildManualDraft</c>). They are
    /// the farmer's own confirmed record, so they are stored as its content, version 1. Returns
    /// <c>null</c> when there is nothing to store, or when the draft does not meet the document's
    /// structure (an item with no string id): then the old path stands alone, exactly as today,
    /// and nothing is refused (doctrine P9).
    /// </summary>
    public static string? FromManualDraft(JsonElement manualDraft)
    {
        if (manualDraft.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var document = new JsonObject { ["schema"] = SchemaVersion };
        var carriesSomething = false;

        foreach (var bucket in Buckets)
        {
            if (!manualDraft.TryGetProperty(bucket, out var rows) || rows.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            if (rows.GetArrayLength() == 0)
            {
                continue;
            }

            document[bucket] = JsonNode.Parse(rows.GetRawText());
            carriesSomething = true;
        }

        if (manualDraft.TryGetProperty("disturbance", out var disturbance)
            && disturbance.ValueKind == JsonValueKind.Object)
        {
            document["disturbance"] = JsonNode.Parse(disturbance.GetRawText());
            carriesSomething = true;
        }

        if (!carriesSomething)
        {
            return null;
        }

        var json = document.ToJsonString(WriteOptions);
        using var parsed = JsonDocument.Parse(json);
        return Validate(parsed.RootElement) is null ? json : null;
    }

    private static void Carry(JsonNode? from, JsonNode? to, IReadOnlySet<string> keys)
    {
        if (from is JsonObject source && to is JsonObject target)
        {
            foreach (var (key, value) in source)
            {
                if (keys.Contains(key))
                {
                    if (value is not null && !target.ContainsKey(key))
                    {
                        target[key] = value.DeepClone();
                    }

                    continue;
                }

                if (target.TryGetPropertyValue(key, out var child))
                {
                    Carry(value, child, keys);
                }
            }

            return;
        }

        if (from is JsonArray sourceItems && to is JsonArray targetItems)
        {
            var sourceById = new Dictionary<string, JsonNode>(StringComparer.Ordinal);
            foreach (var item in sourceItems)
            {
                if (IdOf(item) is { } id)
                {
                    sourceById.TryAdd(id, item!);
                }
            }

            for (var i = 0; i < targetItems.Count; i++)
            {
                var item = targetItems[i];
                // An item is the same item by its id; only an id-less element is matched by place.
                var match = IdOf(item) is { } id
                    ? sourceById.GetValueOrDefault(id)
                    : i < sourceItems.Count && IdOf(sourceItems[i]) is null ? sourceItems[i] : null;
                Carry(match, item, keys);
            }
        }
    }

    private static string? IdOf(JsonNode? node) =>
        node is JsonObject obj
        && obj.TryGetPropertyValue("id", out var id)
        && id is JsonValue value
        && value.TryGetValue<string>(out var text)
            ? text
            : null;

    private static void Strip(JsonNode? node, IReadOnlySet<string> keys)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var key in obj.Select(p => p.Key).Where(keys.Contains).ToList())
                {
                    obj.Remove(key);
                }

                foreach (var child in obj.Select(p => p.Value).ToList())
                {
                    Strip(child, keys);
                }

                break;
            case JsonArray array:
                foreach (var child in array)
                {
                    Strip(child, keys);
                }

                break;
        }
    }
}
