// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 (founder D-78 = 1, D-29, D-31, P3).
using System.Text.Json;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Logs.Content;

/// <summary>One spoken planned item, as the reminder it stands for.</summary>
/// <param name="TaskId">The task id: a UUIDv5 of (log, item) - the same every time (<see cref="PlannedWorkIds"/>).</param>
/// <param name="ItemKey">The item's own id in the content document (<c>job:{index}</c> for an item of a confirmed voice parse).</param>
/// <param name="Title">Only a short title from the item's own title (or description), cut at <see cref="PlannedWork.MaxTitle"/> on a word boundary. Never the transcript, the audio, the source text or the interpretation (D-31).</param>
/// <param name="DueDate">The day, only when the item's cue was clear (D-29); otherwise null.</param>
/// <param name="NamedPlotId">A plot id the item itself carries, if it is a real id. The caller checks it belongs to the farm (E4).</param>
/// <param name="ItemSourceType">The item's own <c>sourceType</c> (<c>ai_extracted</c>, <c>observation_derived</c>, <c>manual</c>), if it has one.</param>
public sealed record SpokenReminder(
    Guid TaskId, string ItemKey, string Title, DateOnly? DueDate, Guid? NamedPlotId, string? ItemSourceType);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4, D-78 = 1) - the reminders a content document's
/// <c>plannedTasks</c> bucket stands for: one per item, written by the SERVER in the same save as the content (like
/// <see cref="LogTaskProjection"/> for the task lines), for every app version, because both create paths go through it.
///
/// <para><b>What is a reminder.</b> An item that is still open (<c>status</c> not done / cancelled), is not schedule work
/// (<c>sourceType</c> schedule has no creating door: D-24e2 / D-75), and has words (its title, else its description). The
/// item stays in the log's own content either way.</para>
///
/// <para><b>What it carries.</b> Its words (cut at the title cap) and a day from its CLEAR cue (<see cref="DueHintResolver"/>,
/// relative to the log's day) - not a date the phone wrote on the item: the old local list filed a typed reminder under the
/// log's day, which is "today by default" (D-29). Nothing of the log's transcript, audio, source text or interpretation.</para>
///
/// <para><b>Which id.</b> <see cref="PlannedWorkIds.ForSpokenItem"/> - the item's own id, never its place in the list.</para>
/// </summary>
public static class PlannedWorkProjection
{
    /// <summary>The reminders for <paramref name="content"/>'s planned items, in the order he said them.</summary>
    public static IReadOnlyList<SpokenReminder> Project(Guid dailyLogId, DateOnly logDay, JsonElement content)
    {
        var found = new List<SpokenReminder>();
        if (content.ValueKind != JsonValueKind.Object
            || !content.TryGetProperty("plannedTasks", out var items)
            || items.ValueKind != JsonValueKind.Array)
        {
            return found;
        }

        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object
                || !item.TryGetProperty("id", out var idElement)
                || idElement.ValueKind != JsonValueKind.String
                || idElement.GetString() is not { Length: > 0 } itemId)
            {
                continue;
            }

            if (Build(PlannedWorkIds.ForSpokenItem(dailyLogId, itemId), itemId, item, logDay) is { } reminder)
            {
                found.Add(reminder);
            }
        }

        return found;
    }

    /// <summary>
    /// A 1.0.17 phone confirms a spoken log through its voice parse (<c>sourceAiJobId</c>) and sends no content document. The
    /// parse's own <c>plannedTasks</c> carry no ids, so an item is keyed by its place in that parse
    /// (<see cref="PlannedWorkIds.ForJobItem"/>): the confirmed parse never changes.
    /// </summary>
    public static IReadOnlyList<SpokenReminder> ProjectJob(Guid dailyLogId, DateOnly logDay, JsonElement normalizedResult)
    {
        var found = new List<SpokenReminder>();
        if (normalizedResult.ValueKind != JsonValueKind.Object
            || !normalizedResult.TryGetProperty("plannedTasks", out var items)
            || items.ValueKind != JsonValueKind.Array)
        {
            return found;
        }

        var index = 0;
        foreach (var item in items.EnumerateArray())
        {
            var place = index++;
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            // Everything the parse returns is what the farmer said: it is the spoken source (no sourceType of its own).
            if (Build(PlannedWorkIds.ForJobItem(dailyLogId, place), $"job:{place}", item, logDay, "ai_extracted") is { } reminder)
            {
                found.Add(reminder);
            }
        }

        return found;
    }

    private static SpokenReminder? Build(Guid taskId, string itemKey, JsonElement item, DateOnly logDay, string? defaultSourceType = null)
    {
        var status = Text(item, "status");
        if (status is "done" or "cancelled")
        {
            return null;
        }

        var sourceType = Text(item, "sourceType") ?? defaultSourceType;
        if (sourceType == "schedule")
        {
            return null;
        }

        var words = Words(Text(item, "title")) ?? Words(Text(item, "description"));
        if (words is null)
        {
            return null;
        }

        Guid? plot = Guid.TryParse(Text(item, "plotId"), out var named) && named != Guid.Empty ? named : null;
        return new SpokenReminder(taskId, itemKey, Cap(words), DueHintResolver.Resolve(Text(item, "dueHint"), logDay), plot, sourceType);
    }

    private static string? Text(JsonElement item, string name) =>
        item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string? Words(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    /// <summary>At most <see cref="PlannedWork.MaxTitle"/> characters, cut between words when the text is longer.</summary>
    private static string Cap(string text)
    {
        const int max = PlannedWork.MaxTitle;
        if (text.Length <= max)
        {
            return text;
        }

        // The cut falls on a space when the text continues with one right after the cap, else on the last space before it.
        var cut = max;
        while (cut > 0 && !char.IsWhiteSpace(text[cut]))
        {
            cut--;
        }

        if (cut <= 0)
        {
            // One word longer than the cap: cut it, never in the middle of a surrogate pair.
            cut = char.IsHighSurrogate(text[max - 1]) ? max - 1 : max;
        }

        return text[..cut].TrimEnd();
    }
}
