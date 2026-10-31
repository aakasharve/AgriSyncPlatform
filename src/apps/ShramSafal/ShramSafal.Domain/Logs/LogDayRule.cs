using ShramSafal.Domain.Dfes;

namespace ShramSafal.Domain.Logs;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; review of lane OF, H1; fix pass 1, B009) — the server
/// rules for the day a record of done work may sit on. "Today" is the farm's India day (<see cref="FarmLocalDay"/>, the
/// one IST rule), never UTC and never the phone. The phone has the same rule (<c>farmDay.ts</c>), so a refusal here is the
/// backstop, not the first line.
///
/// <list type="bullet">
/// <item><b>A move</b> (<c>move_daily_log</c>, sent only by the new app, the day picked by tapping a calendar that shows
/// no later day): never after the farm's TODAY — <see cref="IsAfterFarmToday"/>.</item>
/// <item><b>A create</b> (<c>create_daily_log</c>, sent by every installed phone, dated by the phone's OWN clock): never
/// after the farm's TOMORROW — <see cref="IsAfterFarmTomorrow"/>. An installed phone whose clock runs ahead must never
/// lose a record (P11; old apps have no move to put it right), so only a day beyond tomorrow — a genuinely wrong date —
/// is refused. Orchestrator's call, fix pass 1 (B009), replacing a minutes-wide margin.</item>
/// </list>
/// </summary>
public static class LogDayRule
{
    /// <summary>The farm's India day at <paramref name="nowUtc"/>.</summary>
    public static DateOnly FarmToday(DateTime nowUtc) => FarmLocalDay.From(nowUtc);

    /// <summary>A move: is <paramref name="logDate"/> after the farm's today?</summary>
    public static bool IsAfterFarmToday(DateOnly logDate, DateTime nowUtc) => logDate > FarmToday(nowUtc);

    /// <summary>A create: is <paramref name="logDate"/> after the farm's TOMORROW?</summary>
    public static bool IsAfterFarmTomorrow(DateOnly logDate, DateTime nowUtc) => logDate > FarmToday(nowUtc).AddDays(1);
}
