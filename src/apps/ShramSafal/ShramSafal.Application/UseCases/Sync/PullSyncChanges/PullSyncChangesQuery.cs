using System.Globalization;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <param name="SinceUtc">The phone's cursor (whole seconds on every phone build).</param>
/// <param name="UserId">The signed-in person.</param>
/// <param name="HeldFarmIds">
/// lane MU-3 fix 1 (F9) — the farms the phone holds (optional, additive: older phones send none). Each one
/// this person may no longer read comes back as an explicit <c>accessScopes</c> entry (Paused / Waiting /
/// Removed), which is the only thing that lets the phone remove a farm's data. Fix 2 (N5): <c>null</c> = the
/// phone said nothing (1.0.17, or a phone holding no farm); a list = exactly what it holds, so a readable farm
/// NOT in it is one the phone holds no data for, and is read from the beginning.
/// </param>
/// <param name="ScheduleFormat">
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1, the switch) — the schedule format the phone says it can READ (<c>scheduleFormat=2</c>
/// on the pull; a QUERY parameter, so CORS needs no new header). <c>null</c> = the phone said nothing (1.0.17, or a value that could not be read):
/// it reads today's format only. Slice 1 only carries it; the slice that sends the new task format (slice 2) sends it to a phone that said 2 and
/// sends a phone that said nothing the old projection.
/// </param>
public sealed record PullSyncChangesQuery(
    DateTime SinceUtc,
    Guid UserId,
    IReadOnlyList<Guid>? HeldFarmIds = null,
    int? ScheduleFormat = null)
{
    /// <summary>
    /// Reads the <c>scheduleFormat</c> query value leniently (P11: an older or odd client is never refused for it): a positive whole number is
    /// the format, anything else - missing, empty, text, zero, negative, a fraction, too large - says nothing (<c>null</c>).
    /// </summary>
    public static int? ParseScheduleFormat(string? raw) =>
        int.TryParse(raw?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var format) && format > 0
            ? format
            : null;
}
