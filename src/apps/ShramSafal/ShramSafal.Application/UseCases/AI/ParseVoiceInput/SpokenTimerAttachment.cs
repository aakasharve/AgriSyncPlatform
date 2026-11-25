using System.Text.Json;
using System.Text.Json.Nodes;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, "voice fills the timer")

/// <summary>
/// Puts the timer the farmer SAID (read by the deterministic <see cref="SpokenTimerReader"/> from his own words) INSIDE the one planned-work item
/// of the voice-parse answer, as <c>spokenTimer</c>. Never at the top level: the 1.0.17 phone's top level is strict (<c>AgriLogResponseSchema</c>
/// <c>.strict()</c>) while its planned-task items are <c>.passthrough()</c> (<c>PlannedTaskDraftSchema</c>), so an old phone ignores the new field (P11).
/// Nothing is added when the answer carries no planned work or two or more (which one a timer belongs to would be a guess), or when the words are unclear.
/// </summary>
internal static class SpokenTimerAttachment
{
    internal const string FieldName = "spokenTimer";

    internal static string Attach(string parsedLogJson, string? heardWords)
    {
        if (string.IsNullOrWhiteSpace(parsedLogJson) || string.IsNullOrWhiteSpace(heardWords))
        {
            return parsedLogJson;
        }

        JsonObject root;
        try
        {
            root = JsonNode.Parse(parsedLogJson) as JsonObject ?? new JsonObject();
        }
        catch (JsonException ex)
        {
            // The answer was not JSON: leave it exactly as it came, and leave a trace (no silent swallow).
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "ParseVoice.SpokenTimerSkipped",
                tags: new System.Diagnostics.ActivityTagsCollection { ["exception.type"] = ex.GetType().Name }));
            return parsedLogJson;
        }

        if (root["plannedTasks"] is not JsonArray { Count: 1 } planned || planned[0] is not JsonObject item || item.ContainsKey(FieldName))
        {
            return parsedLogJson;
        }

        var timer = SpokenTimerReader.Read(heardWords);
        if (timer is null)
        {
            return parsedLogJson;
        }

        var value = new JsonObject { ["kind"] = KindName(timer.Kind) };
        if (timer.FromDay is { } fromDay)
        {
            value["fromDay"] = fromDay;
        }

        if (timer.AfterWorkWords is { } afterWork)
        {
            value["afterWorkWords"] = afterWork;
        }

        if (timer.UsualDays is { } usual)
        {
            value["usualDays"] = usual;
        }

        if (timer.SignWords is { } sign)
        {
            value["signWords"] = sign;
        }

        value["heardWords"] = timer.HeardWords;
        value["provenance"] = "spoken";
        item[FieldName] = value;
        return root.ToJsonString();
    }

    private static string KindName(ScheduleTimerKind kind) => kind switch
    {
        ScheduleTimerKind.Day => "day",
        ScheduleTimerKind.After => "after",
        _ => "sign",
    };
}
