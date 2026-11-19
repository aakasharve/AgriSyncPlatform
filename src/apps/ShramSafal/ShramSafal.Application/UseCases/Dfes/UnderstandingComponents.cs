using System.Text.Json;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Application.UseCases.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Reads a
/// <see cref="DailyRichnessAggregate"/>'s <c>components_json</c> (the per-dimension
/// breakdown the derivation service persists) into the <see cref="LensInput"/> that
/// <see cref="DayUnderstandingScore.From"/> rolls up into the /10.
///
/// <para>spec: company-mis-real-numbers-2026-11-15 (plan CR-2c, amendment E5).
/// Lifted UNCHANGED from <c>GetDayUnderstandingHandler.ReadComponents</c> so the day
/// screen and the Company MIS (#10, #49) read a day's breakdown the same way. The day
/// screen keeps its behaviour: it calls this.</para>
/// </summary>
public static class UnderstandingComponents
{
    // An unstamped shell row carries "{}", and a hand-edited row could carry
    // anything. Either way the honest answer is "I have nothing to score" — an
    // EMPTY breakdown, which DayUnderstandingScore turns into null, never a 0.
    private static readonly LensInput NothingScorable = new([], [], []);

    public static LensInput Read(string? componentsJson)
    {
        if (string.IsNullOrWhiteSpace(componentsJson))
        {
            return NothingScorable;
        }

        try
        {
            return JsonSerializer.Deserialize<LensInput>(componentsJson) ?? NothingScorable;
        }
        catch (JsonException ex)
        {
            // An unreadable breakdown means the farmer is shown NO number for a day
            // he did log. Falling back is right — a guessed score would be a
            // fabricated one — but it must never be SILENT, or "no number" looks
            // like "nothing to score" instead of "the row is corrupt".
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "GetDayUnderstanding.MalformedComponentsJson",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    ["exception.type"] = ex.GetType().Name,
                    ["exception.message"] = ex.Message,
                }));
            return NothingScorable;
        }
    }
}
