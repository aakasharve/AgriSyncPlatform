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
    /// backfilled — the version string is how you tell them apart.</para>
    /// <para><c>dfes-3</c> (2026-08-13, founder-decided): two scoring-PARTICIPATION
    /// changes, no weight moved. (1) <c>LEARN_FACET</c> left the farmer-facing
    /// denominator until something in production can actually earn it — see
    /// <see cref="DayUnderstandingScore"/>. (2) <c>DOSE</c> / <c>CARRIER</c> now become
    /// applicable from the OPERATION (a spray / input application is present in the
    /// day) instead of from a NAMED PRODUCT, so naming the product only ever adds to
    /// the numerator and can no longer push the number down. Rows stamped
    /// <c>dfes-2</c> keep the old roster in <c>components_json</c>; the /10 is derived
    /// on read, so change (1) reaches them immediately and change (2) reaches them on
    /// the next recompute.</para>
    /// <para><c>dfes-4</c> (2026-08-16, Wave 3 — bumped ONCE, in wave-3.5, for the whole
    /// wave). Three scoring changes ship under this one version:
    /// <list type="number">
    ///   <item><b>WEATHER retires when the app already has it</b> (3.5, Ruling 3). A
    ///   non-Mock <c>ssf.weather_stamps</c> row for the scored plot on the scored day makes
    ///   WEATHER <c>NotApplicable</c> in the completeness roster, so the farmer is not asked
    ///   to repeat what the app measured. This matters now because 3.9 retired the weather
    ///   QUESTION from the bank: without 3.5 a farmer could lose WEATHER coverage with no
    ///   question offered to fill it.</item>
    ///   <item><b>Water is decided by the PRODUCT, not a method flag</b> (3.4, founder
    ///   decision 14) — dry granular owes no carrier, water-soluble still does, unknown
    ///   keeps asking.</item>
    ///   <item><b>Observation anchoring</b> (3.11).</item>
    /// </list>
    /// <b>Unlike every earlier bump, dfes-4 does NOT reach old rows.</b>
    /// <c>DfesLensExtractor.Build</c> computes <c>appliesNewRules</c> from the version
    /// already stamped on the day's aggregate: a row stamped <c>dfes-1/2/3</c> is scored on
    /// the OLD rules and re-stamped with its ORIGINAL version, so a June day cannot move
    /// because we deployed in August (Ruling 3). Rows with no aggregate yet, and rows
    /// already stamped <c>dfes-4</c>, get the new rules.
    /// <para><b>Known gap, deliberate:</b> the <c>CoverWhat</c> changes in commits
    /// <c>355192b3</c> / <c>c2a11e1b</c> (wave-2.2, "stop crediting a silent day for the
    /// server's own summary") landed BEFORE this guard existed and are still stamped
    /// <c>dfes-3</c>. A <c>dfes-3</c> day recomputed today therefore carries those two
    /// fixes and none of the three above. That is the intended treatment: 2.2 removed a
    /// FABRICATED credit (doctrine P4 outranks number stability), whereas dfes-4 changes
    /// what the day is ASKED — only the latter is frozen.</para>
    /// <para>Nothing in the product READS this string as a feature; it is a forensic
    /// label. <c>appliesNewRules</c> is what actually prevents drift.</para></summary>
    public const string ScoreEngineVersion = "dfes-4";

    /// <summary>Maximum Shram points a single LocalDate can earn after all bonuses.</summary>
    public const int DailyPointCap = 15;

    /// <summary>Reward point values (see <see cref="ShramPointValues"/>).</summary>
    public static ShramPointValues Points => ShramPointValues.Default;

    /// <summary>Streak-fold rules (see <see cref="StreakRules"/>).</summary>
    public static StreakRules Streak => StreakRules.Default;
}
