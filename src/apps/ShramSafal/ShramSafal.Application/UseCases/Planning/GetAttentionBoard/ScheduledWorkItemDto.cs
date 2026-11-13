namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — one scheduled step that needs the
/// farmer today: its day has come and no recorded work met it (<c>ScheduledWorkMatcher</c>). The लक्ष द्या page
/// lists these one by one ("काम नोंदवा" / "पुढे ठरवा"), so the card's overdue NUMBER is no longer the only thing
/// the phone gets. Additive on the wire: an older phone never reads it (its pull reconciler copies only
/// <c>cards</c>), and a newer phone treats its absence as "this server sent no list" (P11).
///
/// <para><b>Lane ATT-W (founder L8-C1 note: "with proof and attention with message why it's important").</b> The members after
/// <see cref="IsMissed"/> are additive, at the END, and say WHY the item is there - every one read from a row, nothing guessed (P4).
/// The first group is set only for a step a FOLLOWED schedule asks (R29: read from the schedule's stored days); an item made from a
/// planned-activity row leaves them null, and an older server never sends them (the phone then draws no line).</para>
/// </summary>
/// <param name="PlannedActivityId">For a planned-activity row its id; for a followed schedule's step a UUIDv5 of
/// (subscription, activity, original day) - the same every time, unchanged by a move.</param>
/// <param name="PlannedDate">The step's reminder day (farm-local), "yyyy-MM-dd" on the wire: the schedule's own day, or the day a
/// person moved it to (R29).</param>
/// <param name="DaysLate">0 = today's step; otherwise the days since its planned day.</param>
/// <param name="IsMissed">True once the step is past its on-time window
/// (<c>ScheduledWorkMatcher.OnTimeToleranceDays</c>) — it now needs a decision: record it, or set a new day.</param>
/// <param name="SubscriptionId">The followed schedule that asks this step (null for a planned-activity row). A move of the step
/// goes to <c>POST /farms/{farmId}/schedule-steps/move</c> with this id.</param>
/// <param name="ScheduleName">That schedule's name.</param>
/// <param name="AlsoAskedBy">The names of the OTHER followed schedules that ask the same work that same day and whose step is still
/// open (R13, R35): shown once, never twice. Null when none.</param>
/// <param name="LastSameWorkDate">The day of the plot's real last record of the same kind of work (WORK-ID <c>Same</c>), from the
/// records the reader may see; null when there is none - the phone then says "अजून नोंद नाही", never "0 दिवस".</param>
/// <param name="RepeatText">How often the schedule STORES the work, as a code the phone words: <c>every_n_days:N</c> or
/// <c>per_week:N</c>; null when no repeat is stored (never guessed). A code, not words, because the phone words it in one
/// language only.</param>
/// <param name="ReasonKey"><c>DueToday</c> (its day is today), <c>Late</c> (past its day, inside the on-time window) or
/// <c>Missed</c> (past the window).</param>
/// <param name="ActivityId">The schedule activity this step is (a move names it).</param>
/// <param name="OriginalDate">The day the schedule itself asks the step (a move names it).</param>
/// <param name="ScheduleDay">That day as the schedule counts it from its day 0 ("दिवस 34").</param>
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
    bool IsMissed,
    Guid? SubscriptionId = null,
    string? ScheduleName = null,
    IReadOnlyList<string>? AlsoAskedBy = null,
    DateOnly? LastSameWorkDate = null,
    string? RepeatText = null,
    string ReasonKey = ScheduledReasonKey.Late,
    Guid? ActivityId = null,
    DateOnly? OriginalDate = null,
    int? ScheduleDay = null);

/// <summary>spec: plr-d10 lane ATT-W - the words of <see cref="ScheduledWorkItemDto.ReasonKey"/> (stable keys, never shown as they are).</summary>
public static class ScheduledReasonKey
{
    public const string DueToday = "DueToday";
    public const string Late = "Late";
    public const string Missed = "Missed";

    /// <summary>Why a step that is not done is on the list: its day is today, it is past its day, or it is past the on-time window.</summary>
    public static string Of(int daysLate, bool isMissed) =>
        daysLate <= 0 ? DueToday : isMissed ? Missed : Late;
}
