namespace ShramSafal.Domain.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Phase 0). THE SINGLE SOURCE of every DFES
/// tunable number. Every downstream phase (2 scoring/derivation, 3 engagement
/// fold + Understanding Bar, 5 question engine) READS from here — no phase may
/// hardcode any of these values. Pure static Domain type, zero dependencies
/// (safe under the Domain layering + architecture tests). The frontend mirror
/// is <c>src/clients/mobile-web/src/features/logs/services/dfesTuning.ts</c>.
/// That mirror's test (<c>dfesTuning.test.ts</c>) parses THIS file (and
/// ShramPointValues.cs / StreakRules.cs) at test time and asserts the TS
/// mirror against the parsed values — so if you change a number here, update
/// <c>dfesTuning.ts</c> too, or the frontend test fails on the next run.
/// </summary>
public static class DfesTuning
{
    /// <summary>Rich DAYS required before the understanding bar is considered arrived.</summary>
    public const int RichDayThreshold = 25;

    /// <summary>Count of AdvancesBar==true days at which UnlockStatus flips to "unlocked" (set-once).</summary>
    public const int UnlockThreshold = 25;

    /// <summary>Stamped onto every aggregate row so recompute results are versioned.
    /// <para><c>dfes-2</c> (2026-08-13): the Day Understanding rollup moved from
    /// "mean over whichever lenses were applicable" to covered-weight ÷ possible-weight
    /// against a FIXED denominator (see <see cref="DayUnderstandingScore"/>), and the
    /// extractor now records the completeness roster in <c>components_json</c>. Rows
    /// still stamped <c>dfes-1</c> were produced by the old rollup and are NOT
    /// backfilled — the version string is how you tell them apart.</para></summary>
    public const string ScoreEngineVersion = "dfes-2";

    /// <summary>Maximum Shram points a single LocalDate can earn after all bonuses.</summary>
    public const int DailyPointCap = 15;

    /// <summary>Reward point values (see <see cref="ShramPointValues"/>).</summary>
    public static ShramPointValues Points => ShramPointValues.Default;

    /// <summary>Streak-fold rules (see <see cref="StreakRules"/>).</summary>
    public static StreakRules Streak => StreakRules.Default;
}
