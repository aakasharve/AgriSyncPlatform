using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// spec: voice-flow-v2-2026-11-23 - one task, shown once. The model put "उद्या urea टाकायचा आहे" in BOTH
/// <c>observations[].extractedTasks</c> and <c>plannedTasks</c>, so the farmer saw the task twice. The phone reads
/// <c>plannedTasks</c>; an <c>extractedTasks</c> item that repeats a planned task (same title, same rawText / sourceText, or
/// the same note id) is removed from <c>extractedTasks</c>. The planned task is never touched, and an extracted task with no
/// planned twin stays.
/// </summary>
internal static partial class DuplicateTaskGuard
{
    public static void Apply(JsonObject root)
    {
        if (root["plannedTasks"] is not JsonArray planned || planned.Count == 0 ||
            root["observations"] is not JsonArray observations)
        {
            return;
        }

        var plannedObjects = planned.OfType<JsonObject>().ToList();
        foreach (var node in observations)
        {
            if (node is not JsonObject observation || observation["extractedTasks"] is not JsonArray tasks)
            {
                continue;
            }

            for (var i = tasks.Count - 1; i >= 0; i--)
            {
                if (tasks[i] is JsonObject task && plannedObjects.Any(p => IsSameTask(task, p)))
                {
                    tasks.RemoveAt(i);
                }
            }
        }
    }

    internal static bool IsSameTask(JsonObject extracted, JsonObject planned) =>
        Matches(extracted, planned, "title", "title") ||
        Matches(extracted, planned, "rawText", "rawText") ||
        Matches(extracted, planned, "rawText", "sourceText") ||
        Matches(extracted, planned, "sourceText", "sourceText") ||
        Matches(extracted, planned, "sourceNoteId", "sourceNoteId") ||
        Matches(extracted, planned, "sourceNoteId", "sourceObservationId");

    private static bool Matches(JsonObject a, JsonObject b, string keyA, string keyB)
    {
        var x = Key(a[keyA]);
        return x.Length > 0 && x == Key(b[keyB]);
    }

    private static string Key(JsonNode? node)
    {
        var text = node is JsonValue value && value.TryGetValue<string>(out var s) ? s : string.Empty;
        return Spaces().Replace(text.Trim().ToLowerInvariant(), " ");
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
