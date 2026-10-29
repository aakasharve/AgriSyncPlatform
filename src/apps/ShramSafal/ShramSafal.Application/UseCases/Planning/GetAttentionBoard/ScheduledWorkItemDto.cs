namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — one scheduled step that needs the
/// farmer today: its day has come and no recorded work met it (<c>ScheduledWorkMatcher</c>). The लक्ष द्या page
/// lists these one by one ("काम नोंदवा" / "पुढे ठरवा"), so the card's overdue NUMBER is no longer the only thing
/// the phone gets. Additive on the wire: an older phone never reads it (its pull reconciler copies only
/// <c>cards</c>), and a newer phone treats its absence as "this server sent no list" (P11).
/// </summary>
/// <param name="PlannedDate">The step's planned day (farm-local), "yyyy-MM-dd" on the wire.</param>
/// <param name="DaysLate">0 = today's step; otherwise the days since its planned day.</param>
/// <param name="IsMissed">True once the step is past its on-time window
/// (<c>ScheduledWorkMatcher.OnTimeToleranceDays</c>) — it now needs a decision: record it, or set a new day.</param>
public sealed record ScheduledWorkItemDto(
    Guid PlannedActivityId,
    Guid FarmId,
    Guid PlotId,
    string PlotName,
    Guid CropCycleId,
    string ActivityName,
    string Stage,
    DateOnly PlannedDate,
    int DaysLate,
    bool IsMissed);
