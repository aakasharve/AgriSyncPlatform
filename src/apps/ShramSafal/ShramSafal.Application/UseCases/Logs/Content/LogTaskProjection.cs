using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ShramSafal.Application.UseCases.Logs.Content;

/// <summary>One task line written from one content item.</summary>
/// <param name="TaskId">The <c>log_tasks</c> id: a UUIDv5 of (log, bucket, item id) — the same every time.</param>
/// <param name="ActivityType">Exactly the string the phone's <c>buildTaskPayloads</c> would send.</param>
/// <param name="Notes">Exactly the notes the phone would send (null = the phone sends none).</param>
/// <param name="Bucket">The content bucket the item lives in.</param>
/// <param name="ItemId">The item's own id inside the document.</param>
public sealed record ProjectedTask(Guid TaskId, string ActivityType, string? Notes, string Bucket, string ItemId);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — the task lines a content
/// document stands for, written by the SERVER in the same save as the content.
///
/// <para><b>Why the server writes them.</b> A phone that sends <c>content</c> sends no
/// <c>add_log_task</c>. But every server reader of <c>LogTask</c> (schedule matching, compliance,
/// the exports, the DFES day root, the job-card path) and every OLDER phone (which rebuilds a log
/// from its tasks) must keep reading exactly what they read today. So this is a word-for-word C#
/// port of the phone's <c>buildTaskPayloads</c> (<c>logTaskPayloads.ts</c>), including its
/// JavaScript truthiness and number formatting. A parity test runs both against one shared
/// fixture of real parse items (<c>sync-contract/tests/fixtures/log-task-projection.json</c>).</para>
///
/// <para><b>Ids that are the same every time.</b> The phone mints a fresh random UUID per send for
/// a non-UUID item id (<c>ensureUuid</c>). Here every task id is a UUIDv5 of the log and the item
/// (even for an item whose own id is a UUID, so two logs that carry the same item id can never
/// collide on the global <c>log_tasks</c> key): a resend or a revision can never write a second
/// line for the same item, and no create can fail on another log's task.</para>
///
/// <para><b>One difference, on purpose.</b> An item whose activity type comes out blank or
/// not-a-string gets no task line (the phone's own <c>add_log_task</c> schema refuses those at
/// enqueue, and <see cref="Domain.Logs.DailyLog.AddTask"/> throws). The item itself stays in the
/// content.</para>
/// </summary>
public static class LogTaskProjection
{
    /// <summary>The task lines for <paramref name="content"/>, in the phone's order.</summary>
    public static IReadOnlyList<ProjectedTask> Project(Guid dailyLogId, JsonElement content)
    {
        var tasks = new List<ProjectedTask>();
        if (content.ValueKind != JsonValueKind.Object)
        {
            return tasks;
        }

        foreach (var item in Items(content, "cropActivities"))
        {
            // activityType: activity.workTypes?.[0] || activity.title — a VALUE, not a template.
            JsonElement? first = null;
            if (item.TryGetProperty("workTypes", out var workTypes) && workTypes.ValueKind == JsonValueKind.Array
                && workTypes.GetArrayLength() > 0)
            {
                first = workTypes[0];
            }

            var chosen = IsTruthy(first) ? first : Get(item, "title");
            var notes = Get(item, "notes") is { ValueKind: JsonValueKind.String } n ? n.GetString() : null;
            Add(tasks, dailyLogId, "cropActivities", item, chosen is { ValueKind: JsonValueKind.String } s ? s.GetString() : null, notes);
        }

        foreach (var item in Items(content, "irrigation"))
        {
            var notes = JoinNotes(
                IsTruthy(Get(item, "method")) ? $"Method: {JsString(Get(item, "method"))}" : null,
                IsTruthy(Get(item, "source")) ? $"Source: {JsString(Get(item, "source"))}" : null,
                IsTruthy(Get(item, "durationHours")) ? $"Duration: {JsString(Get(item, "durationHours"))} hrs" : null,
                StringOrNull(Get(item, "notes")));
            Add(tasks, dailyLogId, "irrigation", item, "Irrigation", notes);
        }

        foreach (var item in Items(content, "inputs"))
        {
            // event.productName || event.mix?.[0]?.productName || 'Input'
            JsonElement? mixFirstName = null;
            if (item.TryGetProperty("mix", out var mix) && mix.ValueKind == JsonValueKind.Array
                && mix.GetArrayLength() > 0 && mix[0].ValueKind == JsonValueKind.Object)
            {
                mixFirstName = Get(mix[0], "productName");
            }

            var productName = IsTruthy(Get(item, "productName"))
                ? JsString(Get(item, "productName"))
                : IsTruthy(mixFirstName) ? JsString(mixFirstName) : "Input";

            var isFertilizer = IsString(Get(item, "type"), "fertilizer")
                || IsString(Get(item, "reason"), "Growth")
                || IsString(Get(item, "reason"), "Deficiency");
            var activityType = isFertilizer ? $"Fertilizer {productName}" : $"Spray {productName}";

            var unit = Get(item, "unit");
            var notes = JoinNotes(
                IsTruthy(Get(item, "quantity")) ? $"Qty: {JsString(Get(item, "quantity"))} {(IsTruthy(unit) ? JsString(unit) : string.Empty)}" : null,
                IsTruthy(Get(item, "cost")) ? $"Cost: ₹{JsString(Get(item, "cost"))}" : null,
                StringOrNull(Get(item, "notes")));
            Add(tasks, dailyLogId, "inputs", item, activityType, notes);
        }

        foreach (var item in Items(content, "machinery"))
        {
            var notes = JoinNotes(
                IsTruthy(Get(item, "hoursUsed")) ? $"Hours: {JsString(Get(item, "hoursUsed"))}" : null,
                IsTruthy(Get(item, "rentalCost")) ? $"Rent: ₹{JsString(Get(item, "rentalCost"))}" : null,
                IsTruthy(Get(item, "fuelCost")) ? $"Fuel: ₹{JsString(Get(item, "fuelCost"))}" : null,
                StringOrNull(Get(item, "notes")));
            Add(tasks, dailyLogId, "machinery", item, $"Machinery {JsString(Get(item, "type"))}", notes);
        }

        foreach (var item in Items(content, "observations"))
        {
            var activityType = IsString(Get(item, "noteType"), "reminder") ? "Reminder" : "Observation";
            // event.textCleaned || event.textRaw — a VALUE.
            var cleaned = Get(item, "textCleaned");
            var chosen = IsTruthy(cleaned) ? cleaned : Get(item, "textRaw");
            var notes = chosen is { ValueKind: JsonValueKind.String } s ? s.GetString() : null;
            Add(tasks, dailyLogId, "observations", item, activityType, notes);
        }

        return tasks;
    }

    /// <summary>The task id for an item: a UUIDv5 of (log, bucket, item id).</summary>
    public static Guid TaskIdFor(Guid dailyLogId, string bucket, string itemId) =>
        UuidV5(dailyLogId, $"{bucket}:{itemId}");

    private static void Add(List<ProjectedTask> tasks, Guid dailyLogId, string bucket, JsonElement item, string? activityType, string? notes)
    {
        if (string.IsNullOrWhiteSpace(activityType))
        {
            return;
        }

        var itemId = item.GetProperty("id").GetString()!;
        tasks.Add(new ProjectedTask(TaskIdFor(dailyLogId, bucket, itemId), activityType, notes, bucket, itemId));
    }

    private static IEnumerable<JsonElement> Items(JsonElement content, string bucket)
    {
        if (!content.TryGetProperty(bucket, out var rows) || rows.ValueKind != JsonValueKind.Array)
        {
            yield break;
        }

        foreach (var item in rows.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object
                && item.TryGetProperty("id", out var id)
                && id.ValueKind == JsonValueKind.String
                && !string.IsNullOrEmpty(id.GetString()))
            {
                yield return item;
            }
        }
    }

    private static JsonElement? Get(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var value) ? value : null;

    private static bool IsString(JsonElement? value, string expected) =>
        value is { ValueKind: JsonValueKind.String } s && s.GetString() == expected;

    private static string? StringOrNull(JsonElement? value) =>
        value is { ValueKind: JsonValueKind.String } s ? s.GetString() : null;

    /// <summary><c>buildTaskNotes</c>: trimmed non-empty parts joined by " • ", or null.</summary>
    private static string? JoinNotes(params string?[] parts)
    {
        var kept = parts
            .Select(p => p?.Trim())
            .Where(p => !string.IsNullOrEmpty(p))
            .ToList();
        return kept.Count == 0 ? null : string.Join(" • ", kept);
    }

    /// <summary>JavaScript truthiness of a JSON value (absent = undefined).</summary>
    private static bool IsTruthy(JsonElement? value) => value switch
    {
        null => false,
        { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined or JsonValueKind.False } => false,
        { ValueKind: JsonValueKind.String } s => s.GetString()!.Length > 0,
        { ValueKind: JsonValueKind.Number } n => n.GetDouble() is var d && d != 0 && !double.IsNaN(d),
        _ => true,
    };

    /// <summary>JavaScript <c>String(value)</c> as a template literal renders it.</summary>
    private static string JsString(JsonElement? value) => value switch
    {
        null => "undefined",
        { ValueKind: JsonValueKind.Null } => "null",
        { ValueKind: JsonValueKind.True } => "true",
        { ValueKind: JsonValueKind.False } => "false",
        { ValueKind: JsonValueKind.String } s => s.GetString()!,
        { ValueKind: JsonValueKind.Number } n => JsNumber(n.GetDouble()),
        { ValueKind: JsonValueKind.Array } a => string.Join(",", a.EnumerateArray().Select(e =>
            e.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? string.Empty : JsString(e))),
        _ => "[object Object]",
    };

    /// <summary>ECMAScript Number::toString(10) for a finite double.</summary>
    public static string JsNumber(double value)
    {
        if (double.IsNaN(value))
        {
            return "NaN";
        }

        if (double.IsInfinity(value))
        {
            return value > 0 ? "Infinity" : "-Infinity";
        }

        if (value == 0)
        {
            return "0";
        }

        var sign = value < 0 ? "-" : string.Empty;
        // The shortest round-trip digits, e.g. "1.5E+16" / "0.25" / "250".
        var shortest = Math.Abs(value).ToString("R", CultureInfo.InvariantCulture);

        // Split "shortest" into significant digits and a decimal exponent n, where
        // value = 0.d1d2...dk × 10^n (ECMAScript's s × 10^(n−k)).
        string mantissa;
        var exponent = 0;
        var e = shortest.IndexOfAny(['E', 'e']);
        if (e >= 0)
        {
            mantissa = shortest[..e];
            exponent = int.Parse(shortest[(e + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
        }
        else
        {
            mantissa = shortest;
        }

        var dot = mantissa.IndexOf('.');
        var intPart = dot >= 0 ? mantissa[..dot] : mantissa;
        var fracPart = dot >= 0 ? mantissa[(dot + 1)..] : string.Empty;
        var digits = (intPart + fracPart).TrimStart('0');
        var leadingZeros = (intPart + fracPart).Length - digits.Length;
        digits = digits.TrimEnd('0');
        var n = intPart.Length - leadingZeros + exponent;
        var k = digits.Length;

        string body;
        if (k <= n && n <= 21)
        {
            body = digits + new string('0', n - k);
        }
        else if (0 < n && n <= 21)
        {
            body = digits[..n] + "." + digits[n..];
        }
        else if (-6 < n && n <= 0)
        {
            body = "0." + new string('0', -n) + digits;
        }
        else
        {
            var exp = n - 1;
            body = digits[..1] + (k > 1 ? "." + digits[1..] : string.Empty)
                + "e" + (exp >= 0 ? "+" : "-") + Math.Abs(exp).ToString(CultureInfo.InvariantCulture);
        }

        return sign + body;
    }

    /// <summary>RFC 4122 name-based UUID, version 5 (SHA-1).</summary>
    private static Guid UuidV5(Guid namespaceId, string name)
    {
        var ns = namespaceId.ToByteArray();
        SwapToNetworkOrder(ns);
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var input = new byte[ns.Length + nameBytes.Length];
        Buffer.BlockCopy(ns, 0, input, 0, ns.Length);
        Buffer.BlockCopy(nameBytes, 0, input, ns.Length, nameBytes.Length);

#pragma warning disable CA5350 // SHA-1 is what RFC 4122 v5 specifies; this is an identifier, not a security boundary.
        var hash = SHA1.HashData(input);
#pragma warning restore CA5350
        var bytes = new byte[16];
        Array.Copy(hash, bytes, 16);
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        SwapToNetworkOrder(bytes);
        return new Guid(bytes);
    }

    private static void SwapToNetworkOrder(byte[] guid)
    {
        (guid[0], guid[3]) = (guid[3], guid[0]);
        (guid[1], guid[2]) = (guid[2], guid[1]);
        (guid[4], guid[5]) = (guid[5], guid[4]);
        (guid[6], guid[7]) = (guid[7], guid[6]);
    }
}
