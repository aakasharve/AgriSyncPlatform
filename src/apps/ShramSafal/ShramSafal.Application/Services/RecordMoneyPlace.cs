using ShramSafal.Application.Ports;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lanes OF-S fix pass 2, OF-M) — WHERE the money of a record's line
/// sits: the record's own place and day. A plot only when the record names exactly one (several plots or the whole farm:
/// none — the money stays at the level the farmer stated, LABOUR_PHASE2 B1b); its crop season the ONE season on that plot
/// whose dates cover the day (none or two → none, never guessed: the phone's <c>resolveMoneyPlace</c>). One copy: a move
/// re-places money with it, and an edit places the money it makes with it.
/// </summary>
public static class RecordMoneyPlace
{
    /// <summary>The plot a record's money names: its one plot, or none.</summary>
    public static Guid? PlotOf(DailyLog log) =>
        log.Scope != DailyLogScope.Plot ? null
        : log.PlotId ?? (log.PlotIds.Count == 1 ? (Guid?)log.PlotIds.First() : null);

    /// <summary>The one season on <paramref name="plotId"/> (this farm) covering <paramref name="day"/>, or none.</summary>
    public static async Task<Guid?> SeasonAsync(
        IShramSafalRepository repository, Guid farmId, Guid plotId, DateOnly day, CancellationToken ct)
    {
        var covering = (await repository.GetCropCyclesByPlotIdAsync(plotId, ct))
            .Where(c => (Guid)c.FarmId == farmId && c.PlotId == plotId
                        && c.StartDate <= day && (c.EndDate is null || c.EndDate >= day))
            .Select(c => c.Id)
            .ToList();
        return covering.Count == 1 ? covering[0] : null;
    }
}
