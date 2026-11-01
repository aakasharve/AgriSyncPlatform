using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>One line of a record that can carry money, read from its content document.</summary>
/// <param name="Kind">The <see cref="MoneyEntryIdentity"/> kind (<c>input</c>, <c>machinery</c>, <c>activity-expense</c>).</param>
/// <param name="LineId">The line's own id (its money id is derived from the record id, the kind and this).</param>
/// <param name="Amount">The amount the line states (0 = none stated: it makes no money).</param>
public sealed record RecordMoneyLine(
    string Kind,
    string LineId,
    decimal Amount,
    string CategoryId,
    string Description,
    decimal? Quantity,
    string? Unit,
    string? VendorName);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lanes OF-S fix pass 2 and OF-M) — WHICH lines of a record make money,
/// how much, and what the money says, read from the record's content document by the phone's own rule for making money
/// from them (<c>LogCommandService.captureMoneyEventsFromLog</c> + <c>recordMoneyLines.ts</c> +
/// <c>financeCommandService.moneyCategoryToCostCategoryId</c>), so money the server makes for an edited line looks exactly
/// like money the phone made for a saved one. ONE copy on the server: the move (what money it needs) and the edit (what
/// money it makes or corrects) both read it.
/// <list type="bullet">
/// <item>an input: its <c>cost</c>; category <c>other</c>; described by its product (or its mix's products); its quantity
/// and unit;</item>
/// <item>a machine: <c>rentalCost</c> + <c>fuelCost</c>; <c>machinery_rent</c>; described by its type; its hours;</item>
/// <item>an expense: <c>totalAmount</c>; its category word mapped as the phone maps it; described by its reason; its
/// vendor.</item>
/// </list>
/// A line with no description is described by its source key, as the phone does. Labour is not here: a crew's money is its
/// stated total, held on the engagement, never in the document.
/// </summary>
public static class RecordMoneyLines
{
    private static readonly (string Bucket, string Kind)[] Buckets =
    [
        ("inputs", MoneyEntryIdentity.Input),
        ("machinery", MoneyEntryIdentity.Machinery),
        ("activityExpenses", MoneyEntryIdentity.ActivityExpense),
    ];

    /// <summary>Every line of the document that has an id, priced or not (Amount 0 when it states none).</summary>
    public static IReadOnlyList<RecordMoneyLine> Of(Guid dailyLogId, JsonElement document)
    {
        var lines = new List<RecordMoneyLine>();
        if (document.ValueKind != JsonValueKind.Object)
        {
            return lines;
        }

        foreach (var (bucket, kind) in Buckets)
        {
            if (!document.TryGetProperty(bucket, out var rows) || rows.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var row in rows.EnumerateArray())
            {
                if (row.ValueKind == JsonValueKind.Object
                    && row.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String
                    && id.GetString() is { Length: > 0 } lineId)
                {
                    lines.Add(LineOf(dailyLogId, kind, lineId, row));
                }
            }
        }

        return lines;
    }

    /// <summary>The fields that hold a line's price, per bucket (the same reading as <see cref="Of"/>).</summary>
    private static readonly (string Bucket, string Kind, string[] Fields)[] PriceFields =
    [
        ("inputs", MoneyEntryIdentity.Input, ["cost"]),
        ("machinery", MoneyEntryIdentity.Machinery, ["rentalCost", "fuelCost"]),
        ("activityExpenses", MoneyEntryIdentity.ActivityExpense, ["totalAmount"]),
    ];

    private static readonly JsonSerializerOptions WriteOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>
    /// spec: plr-d10 (lane OF-M fix pass 5) — an edit made on an older version by a seat that may not change prices, which
    /// changed no price of what it saw: the record's CURRENT prices are carried into it (as his words are carried
    /// forward), so it lands without putting back an older price. A line of his keeps everything but its price, which
    /// is the record's now (none when the record does not price it); a priced line he never saw is kept as it is.
    /// </summary>
    public static string CarryPricesForward(Guid dailyLogId, string currentDocumentJson, string incomingDocumentJson)
    {
        if (JsonNode.Parse(incomingDocumentJson) is not JsonObject incoming
            || JsonNode.Parse(currentDocumentJson) is not JsonObject current)
        {
            return incomingDocumentJson;
        }

        using var currentDocument = JsonDocument.Parse(currentDocumentJson);
        var priced = Of(dailyLogId, currentDocument.RootElement).Where(l => l.Amount > 0m).Select(l => (l.Kind, l.LineId)).ToHashSet();
        foreach (var (bucket, kind, fields) in PriceFields)
        {
            var now = (current[bucket] as JsonArray)?.OfType<JsonObject>()
                .Where(item => IdOf(item) is not null)
                .GroupBy(item => IdOf(item)!)
                .ToDictionary(g => g.Key, g => g.First()) ?? [];
            var his = incoming[bucket] as JsonArray;
            var seen = new HashSet<string>();
            foreach (var item in his?.OfType<JsonObject>() ?? [])
            {
                if (IdOf(item) is not { } id)
                {
                    continue;
                }

                seen.Add(id);
                var from = now.GetValueOrDefault(id);
                foreach (var field in fields)
                {
                    item.Remove(field);
                    if (from?[field] is { } value)
                    {
                        item[field] = value.DeepClone();
                    }
                }
            }

            foreach (var (id, item) in now.Where(n => !seen.Contains(n.Key) && priced.Contains((kind, n.Key))))
            {
                if (his is null)
                {
                    his = [];
                    incoming[bucket] = his;
                }

                his.Add(item.DeepClone());
            }
        }

        return incoming.ToJsonString(WriteOptions);
    }

    private static string? IdOf(JsonObject item) =>
        item["id"] is JsonValue id && id.TryGetValue<string>(out var text) && text.Length > 0 ? text : null;

    /// <summary>The phone's <c>mapActivityExpenseCategory</c> then <c>moneyCategoryToCostCategoryId</c>, as one step.</summary>
    public static string ExpenseCategoryOf(string? category)
    {
        var normalized = (category ?? string.Empty).ToLowerInvariant();
        if (normalized.Contains("labour", StringComparison.Ordinal)) return "labour_misc";
        if (normalized.Contains("fuel", StringComparison.Ordinal)) return "fuel";
        if (normalized.Contains("transport", StringComparison.Ordinal)) return "transport";
        if (normalized.Contains("machinery", StringComparison.Ordinal)) return "machinery_rent";
        if (normalized.Contains("repair", StringComparison.Ordinal)) return "equipment";
        if (normalized.Contains("electric", StringComparison.Ordinal)) return "electricity";
        return "other"; // Input / fertilizer / pesticide (the phone's 'Input') and anything else (its 'Other') both send 'other'
    }

    private static RecordMoneyLine LineOf(Guid dailyLogId, string kind, string lineId, JsonElement row)
    {
        var sourceKey = $"{dailyLogId:D}:{kind}:{lineId}";
        return kind switch
        {
            MoneyEntryIdentity.Input => new RecordMoneyLine(
                kind, lineId, Amount(row, "cost"), "other",
                Describe(Text(row, "productName") ?? MixNames(row), sourceKey), Number(row, "quantity"), Text(row, "unit"), null),
            MoneyEntryIdentity.Machinery => new RecordMoneyLine(
                kind, lineId, Amount(row, "rentalCost") + Amount(row, "fuelCost"), "machinery_rent",
                Describe(Text(row, "type"), sourceKey), Number(row, "hoursUsed"), "hour", null),
            _ => new RecordMoneyLine(
                kind, lineId, Amount(row, "totalAmount"), ExpenseCategoryOf(Text(row, "category")),
                Describe(Text(row, "reason"), sourceKey), null, null, Text(row, "vendor")),
        };
    }

    private static string Describe(string? said, string sourceKey) => string.IsNullOrWhiteSpace(said) ? sourceKey : said;

    /// <summary>The phone's <c>entry.mix?.map(i =&gt; i.productName).join(', ')</c> (an absent name joins as nothing).</summary>
    private static string? MixNames(JsonElement row)
    {
        if (!row.TryGetProperty("mix", out var mix) || mix.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        return string.Join(", ", mix.EnumerateArray().Select(item =>
            item.ValueKind == JsonValueKind.Object ? Text(item, "productName") ?? string.Empty : string.Empty));
    }

    private static string? Text(JsonElement row, string field) =>
        row.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static decimal? Number(JsonElement row, string field)
    {
        var amount = Amount(row, field);
        return row.TryGetProperty(field, out _) && amount != 0m ? amount : null;
    }

    /// <summary>A number the line states (a number, or a number written as text); anything else is none (0).</summary>
    private static decimal Amount(JsonElement row, string field)
    {
        if (!row.TryGetProperty(field, out var value))
        {
            return 0m;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
            JsonValueKind.String when decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var text) => text,
            _ => 0m,
        };
    }
}
