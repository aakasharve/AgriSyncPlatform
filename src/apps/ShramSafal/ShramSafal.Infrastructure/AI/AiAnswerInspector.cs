using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace ShramSafal.Infrastructure.AI;

/// <summary>What is wrong with a model's answer to a sorting call (<see cref="AnswerProblem.None"/> = nothing).</summary>
internal enum AnswerProblem
{
    None,

    /// <summary>Not valid JSON at all (for example a stray <c>- "femaleCount": 3</c> line: the live case of 28 Nov 2026).</summary>
    Unparseable,

    /// <summary>Valid JSON, but not an object (an array, a number, a bare string).</summary>
    NotAnObject,

    /// <summary>No answer, or an object with no property at all.</summary>
    Empty,

    /// <summary>The same key twice with DIFFERENT values (live: <c>"inputs":[2 products]</c> then <c>"inputs":[]</c>).</summary>
    ConflictingDuplicateKeys,

    /// <summary>A day with no <c>dayOutcome</c> (or an unknown one), no work row and no disturbance: nothing to call a work day.</summary>
    NoDayOutcome,
}

/// <summary>The verdict on one answer, and the text to carry on with when it is usable.</summary>
/// <param name="Text">
/// The answer to use: the input as it was, or, when the model repeated a key with the SAME value, the input with the
/// repeats removed. Null when the answer is not usable.
/// </param>
internal sealed record AnswerInspection(
    AnswerProblem Problem,
    string Detail,
    IReadOnlyList<string> ConflictingKeys,
    IReadOnlyList<string> IdenticalRepeatedKeys,
    string? Text)
{
    public bool IsUsable => Problem == AnswerProblem.None;

    /// <summary>
    /// The failure text a provider returns. It says "JSON" and "parse failure" on purpose: the failure classifier then calls
    /// it a parse failure, which is fallback-eligible (the backup sorter runs) and is told to the phone as "the AI failed
    /// this time" (the note is kept and understood later: the unheard-voice path), never as a successful empty day.
    /// </summary>
    public string ErrorText =>
        IsUsable
            ? string.Empty
            : $"The model's answer cannot be used as JSON ({Problem}): {Detail} (parse failure).";
}

/// <summary>
/// 28 Nov 2026 (CTO scope add after the 20-sample test) — the one place that decides whether a model's answer to a sorting
/// call may be kept. Before this, an unparseable answer became an EMPTY successful work day (<c>WORK_RECORDED</c>), and a key
/// repeated with a different value silently kept the LAST one, so a talk could lose its labour or its products and still be
/// reported as a success. Both providers (Gemini and Sarvam) run every answer through here, inside the call that has its own
/// one retry; the normalizer runs it again as a last guard.
///
/// <para>
/// <b>Rules.</b> Unparseable, not an object, or no property at all: broken. The same key twice at any depth: broken when the
/// values differ (never guess which one is right), harmless when they are identical (the repeat is dropped). A day with no
/// usable <c>dayOutcome</c>, no work row and no disturbance is broken, but only when the prompt asked for a day outcome
/// (the verification prompt asks for a score, not a day).
/// </para>
/// </summary>
internal static class AiAnswerInspector
{
    private static readonly string[] WorkBuckets =
        ["cropActivities", "irrigation", "labour", "inputs", "machinery", "activityExpenses"];

    /// <summary>True when the prompt asks the model for a <c>dayOutcome</c> (the sorting prompt does; the verification prompt does not).</summary>
    public static bool PromptAsksForDayOutcome(string? systemPrompt) =>
        !string.IsNullOrEmpty(systemPrompt) && systemPrompt.Contains("dayOutcome", StringComparison.Ordinal);

    public static AnswerInspection Inspect(string? rawJson, bool requireDayOutcome)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
        {
            return Broken(AnswerProblem.Empty, "the model sent no answer");
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(rawJson);
        }
        catch (JsonException ex)
        {
            return Broken(AnswerProblem.Unparseable, $"it is not valid JSON ({Shorten(ex.Message)})");
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return Broken(AnswerProblem.NotAnObject, $"it is a JSON {root.ValueKind.ToString().ToLowerInvariant()}, not an object");
            }

            if (!root.EnumerateObject().Any())
            {
                return Broken(AnswerProblem.Empty, "the answer is an empty object");
            }

            var conflicts = new List<string>();
            var identical = new List<string>();
            Walk(root, "$", conflicts, identical);
            if (conflicts.Count > 0)
            {
                return new AnswerInspection(
                    AnswerProblem.ConflictingDuplicateKeys,
                    $"the same key appears more than once with different values: {string.Join(", ", conflicts)}",
                    conflicts,
                    identical,
                    null);
            }

            if (requireDayOutcome && !HasUsableDayOutcome(root) && !HasWorkOrDisturbance(root))
            {
                return Broken(AnswerProblem.NoDayOutcome, "it names no day outcome and holds no work and no disturbance");
            }

            var text = identical.Count > 0 ? WithoutRepeats(root) : rawJson;
            return new AnswerInspection(AnswerProblem.None, string.Empty, [], identical, text);
        }
    }

    /// <summary>
    /// One log line per problem, with the provider and model named so the cases can be counted
    /// (<c>[answer-check] provider=Sarvam problem=ConflictingDuplicateKeys</c>), and one per harmless repeat.
    /// </summary>
    public static void Log(ILogger logger, string provider, string? model, AnswerInspection inspection)
    {
        if (!inspection.IsUsable)
        {
            logger.LogWarning(
                "[answer-check] provider={Provider} model={Model} problem={Problem} keys={Keys} detail={Detail}",
                provider,
                model ?? "unknown",
                inspection.Problem,
                string.Join(",", inspection.ConflictingKeys),
                inspection.Detail);
        }
        else if (inspection.IdenticalRepeatedKeys.Count > 0)
        {
            logger.LogInformation(
                "[answer-check] provider={Provider} model={Model} problem=IdenticalRepeatedKeys keys={Keys} detail=the repeats had the same value and were dropped",
                provider,
                model ?? "unknown",
                string.Join(",", inspection.IdenticalRepeatedKeys));
        }
    }

    private static AnswerInspection Broken(AnswerProblem problem, string detail) =>
        new(problem, detail, [], [], null);

    private static string Shorten(string message) =>
        message.Length <= 140 ? message : message[..140] + "...";

    // ---------------------------------------------------------------- repeated keys

    private static void Walk(JsonElement element, string path, List<string> conflicts, List<string> identical)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                var byName = new Dictionary<string, List<JsonElement>>(StringComparer.Ordinal);
                foreach (var property in element.EnumerateObject())
                {
                    if (!byName.TryGetValue(property.Name, out var list))
                    {
                        byName[property.Name] = list = [];
                    }

                    list.Add(property.Value);
                }

                foreach (var (name, values) in byName)
                {
                    var keyPath = path + "." + name;
                    if (values.Count > 1)
                    {
                        var first = Canonical(values[0]);
                        if (values.Skip(1).All(v => string.Equals(Canonical(v), first, StringComparison.Ordinal)))
                        {
                            identical.Add(keyPath);
                        }
                        else
                        {
                            conflicts.Add(keyPath);
                        }
                    }

                    foreach (var value in values)
                    {
                        Walk(value, keyPath, conflicts, identical);
                    }
                }

                break;
            case JsonValueKind.Array:
                var index = 0;
                foreach (var item in element.EnumerateArray())
                {
                    Walk(item, $"{path}[{index++}]", conflicts, identical);
                }

                break;
        }
    }

    /// <summary>A text that is equal for two values exactly when they say the same thing (key order inside an object does not matter; numbers compare by value).</summary>
    private static string Canonical(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                return "{" + string.Join(
                    ",",
                    element.EnumerateObject()
                        .Select(p => JsonSerializer.Serialize(p.Name) + ":" + Canonical(p.Value))
                        .OrderBy(s => s, StringComparer.Ordinal)) + "}";
            case JsonValueKind.Array:
                return "[" + string.Join(",", element.EnumerateArray().Select(Canonical)) + "]";
            case JsonValueKind.String:
                return JsonSerializer.Serialize(element.GetString());
            case JsonValueKind.Number:
                return element.TryGetDecimal(out var number)
                    ? number.ToString("G29", CultureInfo.InvariantCulture)
                    : element.GetRawText();
            case JsonValueKind.True:
                return "true";
            case JsonValueKind.False:
                return "false";
            default:
                return "null";
        }
    }

    /// <summary>The answer re-written without the repeats (the first occurrence stays; the others were proven identical).</summary>
    private static string WithoutRepeats(JsonElement root)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            Write(writer, root);
        }

        return Encoding.UTF8.GetString(stream.ToArray());

        static void Write(Utf8JsonWriter writer, JsonElement element)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    writer.WriteStartObject();
                    var seen = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var property in element.EnumerateObject())
                    {
                        if (!seen.Add(property.Name))
                        {
                            continue;
                        }

                        writer.WritePropertyName(property.Name);
                        Write(writer, property.Value);
                    }

                    writer.WriteEndObject();
                    break;
                case JsonValueKind.Array:
                    writer.WriteStartArray();
                    foreach (var item in element.EnumerateArray())
                    {
                        Write(writer, item);
                    }

                    writer.WriteEndArray();
                    break;
                default:
                    element.WriteTo(writer);
                    break;
            }
        }
    }

    // ---------------------------------------------------------------- day outcome

    private static bool HasUsableDayOutcome(JsonElement root) =>
        root.TryGetProperty("dayOutcome", out var outcome) &&
        outcome.ValueKind == JsonValueKind.String &&
        !string.IsNullOrWhiteSpace(outcome.GetString()) &&
        AiResponseNormalizer.AllowedDayOutcomes.Contains(outcome.GetString()!.Trim().ToUpperInvariant());

    /// <summary>
    /// Whether the answer holds what could make a day a work day (a work row) or a disturbed one (a disturbance). Without a
    /// stated day outcome, the normalizer's old default ("WORK_RECORDED") is only ever true of such an answer.
    /// </summary>
    private static bool HasWorkOrDisturbance(JsonElement root)
    {
        foreach (var name in WorkBuckets)
        {
            if (root.TryGetProperty(name, out var bucket) &&
                bucket.ValueKind == JsonValueKind.Array &&
                bucket.GetArrayLength() > 0)
            {
                return true;
            }
        }

        return root.TryGetProperty("disturbance", out var disturbance) &&
               disturbance.ValueKind == JsonValueKind.Object &&
               disturbance.EnumerateObject().Any();
    }
}

/// <summary>
/// A model answer that cannot be used (see <see cref="AiAnswerInspector"/>). Thrown by the normalizer so a broken answer can
/// never come out of it as a successful day; the providers turn it into a failed call.
/// </summary>
internal sealed class BrokenModelAnswerException(AnswerInspection inspection) : Exception(inspection.ErrorText)
{
    public AnswerInspection Inspection { get; } = inspection;
}
