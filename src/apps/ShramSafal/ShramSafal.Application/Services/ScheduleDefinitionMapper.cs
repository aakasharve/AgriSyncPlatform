using System.Security.Cryptography;
using System.Text;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-a; R28, R34, P4) - the ONE place a listed schedule becomes the
/// engine's <see cref="ScheduleDefinition"/> (the stage panel, the comparison, SCH-ADV and ATT-W all read it, so they cannot disagree).
/// <list type="bullet">
/// <item><b>Stages</b> only for a row that STORES its days (<see cref="ScheduleTemplateDto.HasStoredDays"/>); a thin row or built-in
/// sample lists stages the library invented, which are never a window.</item>
/// <item><b>Part</b> is the stored <c>WorkPart</c> name lower-cased (<c>irrigation | nutrition | spray | work</c>, the engine's words).
/// A row with none (words only) takes the library category folded exactly as the phone's <c>partOf</c> folds it: irrigation,
/// fertigation (-> nutrition) and spraying are their own part, every other category is <c>work</c> - a grouping, never a number.</item>
/// <item><b>EndDay / FrequencyMode / IntervalDays</b> only when the activity stores its repeat (<see cref="TemplateActivityDto.StoredFrequencyMode"/>
/// non-null). Otherwise they are null, so the engine expands nothing and shows the work as words (P4: never a guess from the name).</item>
/// <item><b>ActivityId</b> is the stored id; a built-in has none, so one is made from the template id and the work's place in the list
/// (the first 16 bytes of SHA-256 of "templateId:index") - the same on every call, different for every work and every schedule.</item>
/// </list>
/// </summary>
public static class ScheduleDefinitionMapper
{
    public static ScheduleDefinition From(ScheduleTemplateDto template)
    {
        ArgumentNullException.ThrowIfNull(template);
        var stored = template.HasStoredDays == true;
        IReadOnlyList<StageDefinition> stages = stored
            ? template.Stages.Select(s => new StageDefinition(s.Name, s.StartDay, s.EndDay)).ToList()
            : [];

        var activities = template.Activities
            .Select((a, index) =>
            {
                var repeat = stored && a.StoredFrequencyMode is not null && Enum.TryParse<FrequencyMode>(a.StoredFrequencyMode, out var mode)
                    ? mode
                    : (FrequencyMode?)null;
                return new ScheduleActivityDef(
                    a.Id ?? IdFor(template.Id, index),
                    a.Name,
                    string.IsNullOrWhiteSpace(a.Part) ? Fold(a.Category) : a.Part.Trim().ToLowerInvariant(),
                    a.OperationKey,
                    a.Role,
                    a.NutrientKey,
                    a.StartDay,
                    repeat is null ? null : a.EndDay,
                    repeat,
                    repeat is null ? null : a.IntervalDays,
                    a.AfterActivityId);
            })
            .ToList();

        return new ScheduleDefinition(template.Id, template.Name, stages, activities);
    }

    /// <summary>
    /// The stage of the मुख्य schedule that holds <paramref name="day"/> (the first by start day, then end day - the order the engine's
    /// windows use), with its dates; <c>null</c> when the schedule stores no stages or the day is in none (before day 0, after the last stage).
    /// </summary>
    public static (StageDefinition Stage, StageWindow Window)? StageHolding(ScheduleDefinition main, DateOnly mainDayZero, DateOnly day)
    {
        ArgumentNullException.ThrowIfNull(main);
        var ordered = main.Stages.OrderBy(s => s.StartDay).ThenBy(s => s.EndDay).ToList();
        var windows = ScheduleFollowEngine.StageWindows(main, mainDayZero);
        for (var i = 0; i < windows.Count; i++)
        {
            if (day >= windows[i].From && day <= windows[i].To)
            {
                return (ordered[i], windows[i]);
            }
        }

        return null;
    }

    /// <summary>The phone's <c>partOf</c>: irrigation / fertigation / spraying are their own part, everything else is work.</summary>
    internal static string Fold(string? category) => category?.Trim().ToLowerInvariant() switch
    {
        "irrigation" => "irrigation",
        "fertigation" => "nutrition",
        "spraying" or "spray" or "foliar_spray" => "spray",
        _ => "work",
    };

    private static Guid IdFor(Guid templateId, int index)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{templateId:N}:{index}"));
        return new Guid(hash.AsSpan(0, 16));
    }
}
