namespace ShramSafal.Application.UseCases.Dfes.GetRecentQuestionEvents;

/// <summary>
/// Cooldown/anti-repeat projection (camelCase on the wire).
///
/// <para>wave-3.1 (spec: dfes-companion-2026-07-11) — <c>dailyLogId</c> is
/// <c>ssf.question_events.daily_log_id</c>, which has existed and been indexed since
/// <c>20260713052440_AddDfesDataSpine</c> but was never projected onto the wire. Without it
/// the client cannot tell which LOG a past question was about, so wave-3.2's per-log dedupe
/// (spec Ruling 1 — the same log must never receive the same question twice) has nothing to
/// key on. NULL on every row written before wave-3.1, which is exactly why the client treats
/// null as "legacy row, fall back to the day cooldown" rather than as "asked about no log".</para>
///
/// <para>Lane DFES-Q (founder D-H, 2026-11-21) - <c>scheduleCardRef</c> is the schedule task a "why wasn't this done?" question
/// was about, so the phone asks it once per task and never again. NULL on every other question and on every older row; an older
/// phone ignores the field.</para>
/// </summary>
public sealed record RecentQuestionEventDto(
    string questionKey, string triggerType, DateTime? shownAtUtc,
    DateTime createdAtUtc, bool? stageConfirmed, bool? skipped,
    Guid? dailyLogId, string? scheduleCardRef = null);
