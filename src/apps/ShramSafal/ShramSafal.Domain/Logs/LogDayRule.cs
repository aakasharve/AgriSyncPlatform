using ShramSafal.Domain.Dfes;

namespace ShramSafal.Domain.Logs;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; review of lane OF, H1) — THE one server rule for
/// the day a record of done work may sit on: the farm's today or an earlier day, never a later one. "Today" is the
/// farm's India day (<see cref="FarmLocalDay"/>, the one IST rule), never UTC and never the phone. Used by the
/// create path (<c>create_daily_log</c>) and the move (<c>move_daily_log</c>); the phone has the same rule
/// (<c>farmDay.ts</c>) so a refusal here is the backstop, not the first line.
///
/// <para><b>The clock-skew margin, and why it exists.</b> Every phone build — the ones already installed too (P11) —
/// puts a record on the day its OWN clock says. A phone whose clock runs a little fast, saving in the first minutes
/// after its midnight, sends tomorrow's date while the server is still on today; refusing that would park an honest
/// record for the farmer to resolve. So "today" is read <see cref="ClockSkewMargin"/> later than the server's clock.
/// The margin is minutes, never a day: a record dated tomorrow is still refused for the whole of today.</para>
/// </summary>
public static class LogDayRule
{
    /// <summary>How far a phone's clock may run ahead of the server's before its "today" is refused.</summary>
    public static readonly TimeSpan ClockSkewMargin = TimeSpan.FromMinutes(5);

    /// <summary>The latest day a record of done work may sit on, as of <paramref name="nowUtc"/>.</summary>
    public static DateOnly LatestAllowedDay(DateTime nowUtc) => FarmLocalDay.From(nowUtc + ClockSkewMargin);

    /// <summary>Is <paramref name="logDate"/> a day that has not happened yet on the farm?</summary>
    public static bool IsInFuture(DateOnly logDate, DateTime nowUtc) => logDate > LatestAllowedDay(nowUtc);
}
