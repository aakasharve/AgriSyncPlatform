namespace ShramSafal.Domain.Logs;

/// <summary>
/// What the farmer actually asserted about WHERE a <see cref="DailyLog"/> happened.
/// Founder decision O-1 (2026-08-12): "Entire Farm" is an intentional domain
/// assertion — never an arbitrary plot, fake cycle, sentinel, "first available
/// plot", or a NULL whose meaning has to be guessed later.
/// </summary>
/// <remarks>
/// Persisted as the literal member name in <c>ssf.daily_logs.scope varchar(10)</c>
/// (<c>HasConversion&lt;string&gt;()</c>, the same shape
/// <c>disturbance_events.scope</c> already uses). The names below are load-bearing:
/// the <c>ck_daily_logs_scope</c> CHECK constraint compares against these exact
/// strings, so renaming a member is a schema change, not a refactor.
/// </remarks>
public enum DailyLogScope
{
    /// <summary>One named plot and (normally) its crop cycle. The Labour V1 shape.</summary>
    Plot,

    /// <summary>
    /// Two or more named plots sharing ONE engagement (founder decision O-2).
    /// Carries no single <c>plot_id</c> and no <c>crop_cycle_id</c> — cross-cycle
    /// attribution is explicitly deferred rather than guessed.
    /// </summary>
    MultiPlot,

    /// <summary>संपूर्ण शेत — the whole farm, with no plot named at all.</summary>
    Farm,
}
