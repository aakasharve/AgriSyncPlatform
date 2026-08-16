using System.Text.Json;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>Application-layer port of scoreVlog's coverage rules. Parses the source
/// AiJob NormalizedResultJson (canonical AgriLogResponse wire) of every DailyLog in a
/// day, unions their signals, and folds in the persisted ObservationEvent InsightEntry
/// facets, producing the pure-Domain LensInput + ClassifierSignals. Confirmed saved
/// logs get confidenceFactor 1.0 (per-field provenance governor is deferred).</summary>
internal static class DfesLensExtractor
{
    // Dimension weights (engine constants, not DfesTuning). Mirror scoreVlog.ts BASE_WEIGHTS
    // EXCEPT SCOPE: the plot is context-selected up front, so "did you name the plot" must NOT
    // count toward the farmer-facing /10 — the SCOPE dimension is removed from server scoring.
    private const int W_WHAT = 20, W_DOSE = 20, W_CARRIER = 10, W_COST = 12, W_WEATHER = 8;
    private const int W_OBS_FACET = 15, W_LEARN_FACET = 15; // structured-noticing pseudo-dims
    private const double Cf = 1.0;

    /// <param name="Roots">AI-extracted roots (one per DailyLog with a usable AI job).</param>
    /// <param name="Observations">The day's persisted <see cref="ObservationEvent"/> rows.</param>
    /// <param name="PersistedRoots">task-7 (2026-08-13) — one root per DailyLog projected
    /// from its OWN persisted typed rows (labour / irrigation / machinery / disturbance /
    /// tasks) by <see cref="PersistedDayRootBuilder"/>. Every dimension below is scored
    /// against BOTH lists and takes the BETTER of the two, so folding the farmer's real
    /// rows in can only ever reveal detail the AI text alone hid — never remove any.</param>
    /// <param name="AnsweredGaps">task-2 (2026-08-14), founder ruling A — gap dimensions
    /// the farmer answered on this day. Credited into the completeness roster only (see
    /// the crediting block in <see cref="Build"/>): never into the classifier lenses, so
    /// the reward economy does not move. Optional so every pre-existing construction site
    /// keeps compiling; callers that do not pass it credit nothing, same as before.</param>
    /// <param name="SystemWeather">wave-3.5, Ruling 3 — the day's
    /// <see cref="WeatherStamp"/> rows, i.e. weather the APP already holds. Optional;
    /// a caller that passes none simply keeps WEATHER owed, which is the pre-3.5
    /// behaviour.</param>
    /// <param name="PlotId">The single plot the day's logs belong to, or null when the
    /// day spans more than one. A weather stamp for a DIFFERENT plot must not retire the
    /// question, so a multi-plot day deliberately falls back to plot-agnostic matching.</param>
    /// <param name="LocalDate">The farmer-local date being scored, so a stamp from
    /// another day can never satisfy this one.</param>
    /// <param name="ScoredUnderVersion">The <c>score_engine_version</c> already stamped on
    /// this day's aggregate, read BEFORE this recompute overwrites it. Null means a day
    /// this engine has never scored. This is the version guard's only input — see
    /// <c>appliesNewRules</c> in <see cref="Build"/>.</param>
    public sealed record DayData(
        IReadOnlyList<JsonElement> Roots,
        IReadOnlyList<ObservationEvent> Observations,
        IReadOnlyList<JsonElement>? PersistedRoots = null,
        IReadOnlyList<AnsweredGap>? AnsweredGaps = null,
        IReadOnlyList<WeatherStamp>? SystemWeather = null,
        Guid? PlotId = null,
        DateOnly? LocalDate = null,
        string? ScoredUnderVersion = null);

    public static (LensInput Input, ClassifierSignals Signals) Build(DayData data, LensScoresProbe probeSink, bool clientDatePlausible)
    {
        var roots = data.Roots;
        var persisted = data.PersistedRoots ?? [];
        var hasStructuredObs = HasStructuredObservation(data.Observations);
        var hasLearning = HasLearningFacet(data.Observations);

        // ── THE SCORE-ENGINE VERSION GUARD (wave-3.5) ───────────────────────
        //
        // Every scoring change in Wave 3 is dfes-4 behaviour and applies ONLY to a day
        // this engine is allowed to (re)score:
        //   • null       → no aggregate yet. A brand-new day. New rules.
        //   • "dfes-4"   → already on this engine. New rules (idempotent).
        //   • anything   → scored under dfes-1/2/3 and FINAL. OLD rules — and
        //     else         DailyRichnessDerivationService re-stamps the row with its
        //                  ORIGINAL version, never dfes-4, so the row never claims an
        //                  engine it was not scored under.
        //
        // Ruling 3: "do not silently change historical numbers." RecomputeAsync genuinely
        // reaches old days — a late-synced log recomputes ITS date (CreateDailyLogHandler),
        // and answering a question recomputes that day (RecordQuestionEventHandler) — so
        // without this a farmer's June number could move because we deployed in August.
        //
        // 🛑 THIS IS THE SWITCH FOR THE WHOLE WAVE, NOT JUST WEATHER. 3.5's weather rule
        // reads it below. When 3.4 lands, its product-based water rule must read it too:
        //     if (appliesNewRules && !OwesWater(roots)) return Cover.NotApplicable;
        // and when 3.11 lands, its observation-anchoring test is likewise
        // `appliesNewRules && …`. A Wave-3 scoring change that does NOT consult this
        // boolean silently rescores history and defeats the guard for every other change
        // as well.
        //
        // Deliberately compared against DfesTuning.ScoreEngineVersion rather than a
        // literal "dfes-4": the next engine bump then re-freezes dfes-4 days automatically
        // instead of needing this line remembered.
        var appliesNewRules = data.ScoredUnderVersion is null
                           || data.ScoredUnderVersion == DfesTuning.ScoreEngineVersion;

        // ── the day's dimensions, scored once ───────────────────────────────
        // ALWAYS possible (any day can carry these — nothing about the work performed
        // can make them impossible), so each one always has a coverage, 0 included.
        // Each rule runs UNCHANGED over the AI roots and over the persisted roots; the
        // better answer wins (Math.Max / Best). Reading the farmer's own rows can
        // therefore never LOWER a dimension he had already been credited for.
        var what = Dim("WHAT", W_WHAT, Math.Max(CoverWhat(roots), CoverWhat(persisted)));
        var cost = Dim("COST", W_COST, Math.Max(CoverCost(roots), CoverCost(persisted)));
        var weather = Dim("WEATHER", W_WEATHER, Math.Max(
            CoverWeather(roots, data.Observations), CoverWeather(persisted, data.Observations)));
        var obsFacet = Dim("OBS_FACET", W_OBS_FACET, hasStructuredObs ? 1.0 : 0.0);
        var learnFacet = Dim("LEARN_FACET", W_LEARN_FACET, hasLearning ? 1.0 : 0.0);
        // CONDITIONAL on the operations actually performed — Cover.NotApplicable when
        // the work they describe never happened (a DOSE on an irrigation-only day).
        //
        // TWO readings of "applicable", deliberately kept apart (dfes-3, 2026-08-13):
        //   • the LENS reading (below) is unchanged and feeds ThreeLensScorer →
        //     DayClassifier → the reward economy. Calibration there is founder-gated,
        //     so this change does not move it by a single point.
        //   • the ROSTER reading (doseOwed / carrierOwed) is the farmer-facing /10's
        //     denominator only, and is the one the founder's decision changes.
        var dose = Dim("DOSE", W_DOSE, Best(CoverDose(roots), CoverDose(persisted)));           // input-op only
        var carrier = Dim("CARRIER", W_CARRIER, Best(CoverCarrier(roots), CoverCarrier(persisted))); // input- or irrigation-op
        //
        // wave-3.4, founder decision 14 — `carrierOwed` additionally consults the PRODUCT
        // (see OwedCarrier / OwesWater below). It reads `appliesNewRules` for exactly the
        // reason the guard block above states: it is a scoring change, so a day already
        // scored under dfes-3 must keep asking. `doseOwed` is untouched — a dry fertiliser
        // still has a dose.
        var doseOwed = Dim("DOSE", W_DOSE, Best(OwedDose(roots), OwedDose(persisted)));
        var carrierOwed = Dim("CARRIER", W_CARRIER,
            Best(OwedCarrier(roots, appliesNewRules), OwedCarrier(persisted, appliesNewRules)));

        // wave-3.5, Ruling 3 — do not ask the farmer to repeat weather the app already
        // knows. `weather` above (the LENS reading) is UNTOUCHED: it feeds ThreeLensScorer
        // → DayClassifier → the reward economy, whose calibration is founder-gated. This
        // is the ROSTER reading, i.e. the farmer-facing /10's denominator, and it is the
        // only place the retirement happens.
        //
        // 🛑 It lives HERE and never in DayUnderstandingScore.NotYetEarnable. The /10 is
        // derived on READ from components_json (GetDayUnderstandingHandler), so a read-time
        // exclusion would rescore every historical row the instant the API deploys, before
        // any recompute — precisely what Ruling 3 forbids. Written into the roster, it
        // reaches a day only when that day is legitimately rescored, and only when
        // appliesNewRules says so.
        //
        // 3.9 retired the weather QUESTION from the bank. Until this lands, a farmer can
        // lose WEATHER coverage with no question offered to fill it — a number that can sit
        // lower with no route to raise it. That is what this closes.
        var weatherOwed = Dim("WEATHER", W_WEATHER,
            appliesNewRules
            && HasUsableWeather(data.SystemWeather ?? [], data.PlotId, data.LocalDate ?? default)
                ? Cover.NotApplicable
                : new Cover(true, Math.Max(
                    CoverWeather(roots, data.Observations), CoverWeather(persisted, data.Observations))));

        // ── the 3 lenses (classifier + persisted lens scores) ───────────────
        // Shape is UNCHANGED: a facet dimension appears in its lens only when the
        // farmer actually gave that signal, so ThreeLensScorer's 0–100 outputs — and
        // therefore DayClassifier's RichWorkDay thresholds — behave exactly as before.
        var execution = new List<ScoredDimension> { what, cost, dose, carrier };
        var insight = new List<ScoredDimension> { weather };
        if (hasStructuredObs) insight.Add(obsFacet);
        var learning = new List<ScoredDimension>();
        if (hasLearning) learning.Add(learnFacet);

        // ── the completeness roster (ONE fixed denominator, all 3 lenses) ────
        // Every dimension that COULD apply to this day's work, covered or not. This is
        // what DayUnderstandingScore divides by, and it is the reason the farmer-facing
        // /10 can no longer FALL when he answers Sathi and adds a signal: an absent
        // OBS_FACET / LEARN_FACET is already in the denominator at coverage 0, so
        // supplying it can only add to the numerator. DOSE/CARRIER carry their own
        // Applicable flag and drop out of both sums when the work never happened.
        //
        // dfes-3: the roster takes doseOwed/carrierOwed — applicable from the day's
        // OPERATION rather than from a named product — so "I sprayed" already owes both
        // and "…with Confidor" only fills them in. LEARN_FACET is still RECORDED here
        // (the roster stays a complete picture of the day) but DayUnderstandingScore
        // skips it while nothing in production can earn it; see its NotYetEarnable.
        // task-2 (2026-08-14), founder ruling A — an answered gap credits the
        // dimension the farmer actually answered, at the dimension's own weight,
        // into the completeness ROSTER only. Never into `execution`/`insight` above
        // (those are already built from the roots/persisted rows and stay exactly
        // what the day's data shows — the classifier and reward economy do not
        // move). Never additive on top of a logged fact — answering is a second
        // route to the same point, not a bonus, so a dimension already at coverage
        // 1.0 is left untouched. A dimension that cannot apply to this day's work
        // (Applicable == false) is also left untouched — answering never invents
        // applicability the day's own data did not show (doctrine P4).
        //
        // Controller Ruling R2 (binding): the creditable set is EXACTLY the
        // dimensions the extractor already weighs — WHAT, DOSE, CARRIER, COST,
        // WEATHER. SCOPE was deliberately removed from scoring and PURPOSE /
        // CONTINUITY never had a weight, so an answered gap for any of them
        // matches no case below and credits nothing.
        var gaps = data.AnsweredGaps ?? [];
        var possible = new List<ScoredDimension>
        {
            Credit(what, "WHAT", gaps),
            Credit(cost, "COST", gaps),
            Credit(doseOwed, "DOSE", gaps),
            Credit(carrierOwed, "CARRIER", gaps),
            // weatherOwed, not `weather`: when the app already holds the day's weather the
            // bucket is NotApplicable, and Credit is a documented no-op on a
            // non-applicable dimension — so a legacy gap.weather answer can never
            // resurrect a retired bucket.
            Credit(weatherOwed, "WEATHER", gaps),
            obsFacet,
            learnFacet,
        };

        var input = new LensInput(execution, insight, learning, possible);

        // ── Signals (unioned across all logs AND both root sources) ─────────
        var hasWork = roots.Any(HasWork) || persisted.Any(HasWork);
        var hasDisturbance = roots.Any(HasDisturbanceReason) || persisted.Any(HasDisturbanceReason);
        var hasMeaningfulObs = hasStructuredObs || data.Observations.Any(o => o.TextRaw.Trim().Length >= 8);
        var hasExperiment = data.Observations.Any(o => !string.IsNullOrWhiteSpace(o.Hypothesis)
                                                       && !string.IsNullOrWhiteSpace(o.Evidence));
        var hasFollowup = data.Observations.Any(o => o.SourceQuestionId is not null
                                                    || !string.IsNullOrWhiteSpace(o.NextAction));
        var (declared, reasonCode) = DeclaredNoWork(roots.Count > 0 ? [.. roots, .. persisted] : persisted);
        var isSilent = !hasWork && !hasDisturbance && !hasMeaningfulObs && !hasLearning;

        var scores = ThreeLensScorer.Score(input);
        probeSink.Scores = scores; // hand the computed scores back to the caller (avoids re-scoring)

        var signals = new ClassifierSignals(
            ClientDatePlausible: clientDatePlausible,
            HasWork: hasWork,
            IsSilent: isSilent,
            HasMeaningfulObservation: hasMeaningfulObs,
            HasLearning: hasLearning,
            HasExperimentOutcome: hasExperiment,
            HasDisturbance: hasDisturbance,
            HasDeclaredNoWorkReason: declared,
            NoWorkReasonCode: reasonCode,
            ExecutionScore: scores.ExecutionScore,
            InsightScore: scores.InsightScore,
            LearningScore: scores.LearningScore,
            HasStructuredObservation: hasStructuredObs,
            HasFollowup: hasFollowup);

        return (input, signals);
    }

    // Mutable carrier so Build can return the already-computed scores to RecomputeAsync.
    public sealed class LensScoresProbe { public LensScores Scores { get; set; } }

    // ── coverage rules (ported from scoreVlog.ts) ───────────────────────────
    private static double CoverWhat(IReadOnlyList<JsonElement> roots)
    {
        var hasActivity = roots.Any(r => Arr(r, "cropActivities").Any(a => !string.IsNullOrWhiteSpace(Str(a, "title"))));
        var hasDisturbance = roots.Any(HasDisturbanceReason);
        var hasSummary = roots.Any(r => !string.IsNullOrWhiteSpace(Str(r, "summary")));
        if (hasActivity || hasDisturbance) return 1.0;
        return hasSummary ? 0.5 : 0.0;
    }

    private static Cover CoverDose(IReadOnlyList<JsonElement> roots)
    {
        var inputs = roots.SelectMany(r => Arr(r, "inputs")).ToList();
        if (inputs.Count == 0) return Cover.NotApplicable;
        var hasProduct = inputs.Any(i => !string.IsNullOrWhiteSpace(Str(i, "productName"))
            || Arr(i, "mix").Any(m => !string.IsNullOrWhiteSpace(Str(m, "productName"))));
        if (!hasProduct) return new Cover(true, 0.0);
        var hasDose = inputs.Any(i => Arr(i, "mix").Any(m => Num(m, "dose") is not null));
        return new Cover(true, hasDose ? 1.0 : 0.5);
    }

    // FOUNDER DECISION 14 (2026-08-16) — SUPERSEDES the 2026-08-13 decision that lived
    // here. On 2026-08-13 the founder was asked whether a soil-applied fertiliser should
    // still owe the water question and answered "keep asking"; this comment then forbade
    // a `method == "Soil"` bypass.
    //
    // Decision 14 does NOT restore that bypass — it removes the method flag from the
    // decision entirely. Water-owing is resolved from the PRODUCT
    // (ShramSafal.Domain.Dfes.ProductWaterAffinity, applied in OwedCarrier below):
    //   • 0:52:34 (MKP) owes water even when the row is flagged method "Soil"
    //   • DAP does not owe it even when the row is flagged method "Spray"
    //   • an unrecognised product keeps asking, which is the 2026-08-13 behaviour intact
    // Under the forbidden bypass the first and third of those would go silent, so the two
    // rules are distinguishable in behaviour and not merely in wording. That is why this
    // is not the bypass the 2026-08-13 note forbade.
    //
    // The founder's words: "it must understand from the word, or not flagging it anywhere,
    // but keep that fertilizer name — such as a farmer might say '0 52 34 दिल', that means
    // an NPK grade that is given. We already made the AI intelligent enough, don't just
    // confuse it." Follow-up ruling: `fertiliser rule = dry granular`.
    //
    // Do NOT reintroduce a method test as the PRIMARY signal without a newer founder
    // ruling. `inputs[].method` may act as a tie-breaker only — it may never override an
    // affinity that resolved from the product.
    //
    // CoverCarrier itself is unchanged: it still measures what the farmer DESCRIBED. The
    // product rule changes only what the day OWES, which lives in OwedCarrier.
    private static Cover CoverCarrier(IReadOnlyList<JsonElement> roots)
    {
        var inputs = roots.SelectMany(r => Arr(r, "inputs")).ToList();
        var irrig = roots.SelectMany(r => Arr(r, "irrigation")).ToList();
        if (inputs.Count == 0 && irrig.Count == 0) return Cover.NotApplicable;
        if (inputs.Count == 0) // pure irrigation
        {
            var method = irrig.Any(i => Str(i, "method") is { Length: > 0 } m && m != "unknown");
            if (!method) return new Cover(true, 0.0);
            var dur = irrig.Any(i => Num(i, "durationHours") is not null || Num(i, "waterVolumeLitres") is not null);
            var src = irrig.Any(i => !string.IsNullOrWhiteSpace(Str(i, "source")));
            return new Cover(true, dur && src ? 1.0 : 0.5);
        }
        var vol = inputs.Any(i => Num(i, "computedWaterVolume") is not null);
        var cnt = inputs.Any(i => Num(i, "carrierCount") is not null);
        var typ = inputs.Any(i => !string.IsNullOrWhiteSpace(Str(i, "carrierType")));
        if (vol || (cnt && typ)) return new Cover(true, 1.0);
        return new Cover(true, cnt || typ ? 0.5 : 0.0);
    }

    // ── what the DAY OWES, as opposed to what it happens to describe (dfes-3) ──
    //
    // spec: dfes-truthful-number-2026-08-13, founder decision B. A spraying /
    // fertilising day owes DOSE and CARRIER from the moment the OPERATION is known,
    // whether or not a product was ever named.
    //
    // The defect: applicability keyed off the `inputs[]` array, and the extraction
    // pipeline only emits an `inputs[]` row once a product is mentioned. So
    //   "I sprayed."                → DOSE / CARRIER not applicable → 10/10
    //   "I sprayed, with Confidor." → both join the denominator      →  8/10
    // He told us MORE and the number FELL — the exact lie the screen must not tell.
    // Now the denominator is set by the operation, so naming the product can only
    // ever raise the numerator.
    //
    // BOUNDARY: a day with no application at all still owes NEITHER. The operation
    // test is CompareEngine.Categorize — the codebase's ONE activity-name →
    // operation-type vocabulary, already used by the stage comparison — so no second
    // keyword list is invented here. "Spraying" and "Fertilizer application" (the
    // titles real LogTask rows carry) bucket as spray / fertigation; "Irrigation",
    // "Observation" and "Machinery" do not, and those days are untouched.
    private static readonly HashSet<string> ApplicationBuckets =
        new(StringComparer.OrdinalIgnoreCase) { "spray", "fertigation" };

    private static bool HasApplicationOperation(IReadOnlyList<JsonElement> roots)
        => roots.Any(r => Arr(r, "cropActivities")
            .Select(a => Str(a, "title"))
            .Any(t => !string.IsNullOrWhiteSpace(t)
                      && ApplicationBuckets.Contains(CompareEngine.Categorize(t!))));

    // Both wrappers are strictly ADDITIVE over the lens rule: they can turn a
    // NotApplicable into applicable-at-coverage-0, and can never lower a coverage the
    // farmer had already earned. Coverage 0 is honest — the operation happened and he
    // has not described it yet; no credit is invented for him.
    private static Cover OwedDose(IReadOnlyList<JsonElement> roots)
    {
        var described = CoverDose(roots);
        return described.Applicable || !HasApplicationOperation(roots)
            ? described
            : new Cover(true, 0.0);
    }

    /// <summary>
    /// wave-3.4, founder decision 14 (2026-08-16). Every product row on the day, and what
    /// it owes.
    ///
    /// <para><b>The day owes CARRIER when ANY product on it is water-carried, OR when at
    /// least one product is UNKNOWN.</b> It owes nothing only when EVERY named product is
    /// dry. The asymmetry is deliberate: one unrecognised product is enough to keep the
    /// question, because retiring it would remove the farmer's only route to fill that
    /// bucket on a day we may simply have failed to recognise (doctrine P4).</para>
    ///
    /// <para>A day that named no product at all keeps today's behaviour exactly — that is
    /// the <c>Count == 0</c> line, and it is what stops this change touching "I sprayed."
    /// (decision B, dfes-3) or a pure-irrigation day.</para>
    ///
    /// <para><c>inputs[].method</c> is not read here, by design. See the decision-14
    /// comment on <see cref="CoverCarrier"/>.</para>
    /// </summary>
    private static bool OwesWater(IReadOnlyList<JsonElement> roots)
    {
        var affinities = roots
            .SelectMany(r => Arr(r, "inputs"))
            .SelectMany(i => Arr(i, "mix").Any()
                ? Arr(i, "mix").Select(m => ProductWaterAffinity.Resolve(Str(m, "npkGrade"), Str(m, "productName")))
                : [ProductWaterAffinity.Resolve(Str(i, "npkGrade"), Str(i, "productName"))])
            .ToList();

        if (affinities.Count == 0) return true;               // no product named → today's rule
        return !affinities.All(a => a == WaterAffinity.Dry);  // all-dry → owes nothing
    }

    /// <param name="appliesNewRules">The wave-3.5 score-engine version guard. Decision 14
    /// is a SCORING change, so a day already scored under dfes-1/2/3 must keep asking —
    /// otherwise a farmer's June number would move because we deployed in August.</param>
    private static Cover OwedCarrier(IReadOnlyList<JsonElement> roots, bool appliesNewRules)
    {
        var described = CoverCarrier(roots);

        // Decision 14 — the whole of the change, in one line.
        if (appliesNewRules && !OwesWater(roots)) return Cover.NotApplicable;

        return described.Applicable || !HasApplicationOperation(roots)
            ? described
            : new Cover(true, 0.0);
    }

    private static double CoverCost(IReadOnlyList<JsonElement> roots)
    {
        var labour = roots.SelectMany(r => Arr(r, "labour")).ToList();
        var anyTotal = roots.SelectMany(r => Arr(r, "labour").Concat(Arr(r, "machinery")).Concat(Arr(r, "activityExpenses")))
            .Any(e => Num(e, "totalCost") is > 0 || Num(e, "rentalCost") is > 0 || Num(e, "amount") is > 0);
        if (labour.Count > 0)
        {
            var hasRate = labour.Any(l => Num(l, "wagePerPerson") is not null || Num(l, "rate") is not null
                                          || Num(l, "totalCost") is > 0);
            if (anyTotal && hasRate) return 1.0;
            return hasRate || anyTotal ? 0.5 : 0.0;
        }
        return anyTotal ? 1.0 : 0.0;
    }

    private static double CoverWeather(IReadOnlyList<JsonElement> roots, IReadOnlyList<ObservationEvent> obs)
    {
        var hasReason = roots.Any(HasDisturbanceReason);
        var weatherObs = obs.Any(o => (o.TagsJson ?? "").Contains("weather", StringComparison.OrdinalIgnoreCase)
            || (o.TagsJson ?? "").Contains("rain", StringComparison.OrdinalIgnoreCase));
        if (hasReason || weatherObs) return 1.0;
        return roots.Any(r => Obj(r, "disturbance").ValueKind == JsonValueKind.Object) ? 0.5 : 0.0;
    }

    /// <summary>
    /// wave-3.5, Ruling 3 (2026-08-15). Weather stops being something the FARMER owes only
    /// when the APP genuinely has it for this plot on this day.
    ///
    /// <para><b>"Usable" is defined narrowly, and honestly.</b> <see cref="WeatherStamp"/>
    /// carries no confidence and no staleness field — its columns are DailyLogId, PlotId,
    /// TimestampLocal, TimestampProvider, Provider, TempC, Humidity, WindKph, PrecipMm,
    /// CloudCoverPct, ConditionText, IconCode, RainProbNext6h, WindGustKph,
    /// SoilMoisture0To10, UvIndex, AlertsJson, CreatedAtUtc. The only honest signals are
    /// therefore the PROVIDER and the OBSERVATION TIME; anything richer would be invented
    /// (doctrine P4).</para>
    ///
    /// <list type="bullet">
    ///   <item><b>Never Mock.</b> <c>CreateDailyLogHandler.MapWeatherProvider</c> sends
    ///   every unrecognised provider string to <c>Mock</c>, so Mock means "unknown
    ///   provider" as well as "fake data" — both are reasons not to trust it.</item>
    ///   <item><b>The scored plot.</b> A stamp for a different plot says nothing about this
    ///   one. When the day spans several plots the caller passes null and matching becomes
    ///   plot-agnostic, because the day has no single plot to be wrong about.</item>
    ///   <item><b>The scored day.</b> <c>TimestampProvider</c> is the provider's own
    ///   observation instant, stored UTC (<c>CreateDailyLogHandler.ParseTimestamp</c> parses
    ///   with <c>AdjustToUniversal</c>), and is mapped through <see cref="FarmLocalDay"/> —
    ///   the same one rule the derivation service, the question handler and the repository
    ///   already share, so this cannot drift into an off-by-one against them.</item>
    /// </list>
    ///
    /// <para>Missing, mock or wrong-day weather leaves the bucket OWED. Retiring it on
    /// anything weaker would tell the farmer his day is complete on the strength of data
    /// we do not actually have.</para>
    /// </summary>
    private static bool HasUsableWeather(
        IReadOnlyList<WeatherStamp> stamps, Guid? plotId, DateOnly localDate)
        => stamps.Any(s => s.Provider != WeatherProvider.Mock
            && (plotId is null || s.PlotId == plotId)
            && FarmLocalDay.From(s.TimestampProvider) == localDate);

    // ── facet / signal predicates ───────────────────────────────────────────

    // The note types that mean "the farmer LOOKED at his field and told us what he
    // saw". The extraction prompt (AiPromptBuilder) splits exactly that act into two
    // labels — `observation` for a field condition, `issue` for a problem / disease /
    // deficiency — so both are a noticing and both belong here.
    //
    // FIX (task-7, 2026-08-13): only `Observation` used to qualify, which made
    // OBS_FACET unreachable in practice — every noticing the pipeline produced for
    // this farmer came back labelled `issue` ("खोडांवरती काळा डाग दिसतोय" — black
    // spots on the trunks), so 15 points of the denominator could never be earned no
    // matter what he said. The same function already counted these very rows as
    // HasMeaningfulObservation, so the engine was simultaneously asserting "he made a
    // meaningful observation" and scoring that dimension 0.
    //
    // Deliberately EXCLUDED: `Reminder` (future intent — tomorrow's work, not a
    // noticing), `Tip` (wisdom — that is LEARN_FACET's signal, credited there), and
    // `Unknown` (the extractor could not classify it; crediting it would be a guess).
    private static readonly HashSet<ObservationNoteType> NoticingNoteTypes =
    [
        ObservationNoteType.Observation, ObservationNoteType.Issue
    ];

    private static bool HasStructuredObservation(IReadOnlyList<ObservationEvent> obs)
        => obs.Any(o => !string.IsNullOrWhiteSpace(o.Observation) || !string.IsNullOrWhiteSpace(o.Change)
            || !string.IsNullOrWhiteSpace(o.Comparison) || !string.IsNullOrWhiteSpace(o.Challenge)
            || !string.IsNullOrWhiteSpace(o.Uncertainty)
            // Same content floor as before — an 8-character minimum, so an empty or
            // one-word note is never credited just because a row exists.
            || (NoticingNoteTypes.Contains(o.NoteType) && o.TextRaw.Trim().Length >= 8));

    private static bool HasLearningFacet(IReadOnlyList<ObservationEvent> obs)
        => obs.Any(o => !string.IsNullOrWhiteSpace(o.Learning) || o.NoteType == ObservationNoteType.Tip);

    private static bool HasWork(JsonElement r)
        => Arr(r, "cropActivities").Any() || Arr(r, "inputs").Any() || Arr(r, "irrigation").Any()
           || Arr(r, "labour").Any() || Arr(r, "machinery").Any();

    private static bool HasDisturbanceReason(JsonElement r)
        => !string.IsNullOrWhiteSpace(Str(Obj(r, "disturbance"), "reason"));

    private static (bool Declared, string? ReasonCode) DeclaredNoWork(IReadOnlyList<JsonElement> roots)
    {
        foreach (var r in roots)
        {
            var outcome = Str(r, "dayOutcome");
            var dist = Obj(r, "disturbance");
            var cause = Str(dist, "cause");
            var scope = Str(dist, "scope");
            var blocking = scope is "FULL_DAY" or "DELAYED";
            if (string.Equals(outcome, "NO_WORK_PLANNED", StringComparison.OrdinalIgnoreCase))
                return (true, cause ?? "rest");
            if (blocking && !string.IsNullOrWhiteSpace(Str(dist, "reason")))
                return (true, cause ?? "blocked");
        }
        return (false, null);
    }

    // ── tolerant JSON readers + tiny helpers ────────────────────────────────
    private readonly record struct Cover(bool Applicable, double Value)
    {
        public static readonly Cover NotApplicable = new(false, 0.0);
    }

    // task-7 — the better of the same rule's answer over the AI roots and over the
    // farmer's persisted rows. A dimension is applicable if EITHER source shows the
    // work happened; among the applicable answers the HIGHER coverage wins, so a
    // second look at the same day can never take credit away.
    private static Cover Best(Cover a, Cover b) => (a.Applicable, b.Applicable) switch
    {
        (false, false) => Cover.NotApplicable,
        (true, false) => a,
        (false, true) => b,
        _ => new Cover(true, Math.Max(a.Value, b.Value)),
    };

    private static ScoredDimension Dim(string name, int weight, double coverage)
        => new(name, weight, Applicable: true, Coverage: coverage, ConfidenceFactor: Cf);

    private static ScoredDimension Dim(string name, int weight, Cover c)
        => new(name, weight, c.Applicable, c.Value, Cf);

    // task-2 (2026-08-14) — fill `dim` to full coverage when the farmer answered
    // its dimension AND the day has not already earned it. A no-op when: the
    // dimension does not apply to this day's work (Applicable false — never
    // invent applicability); the dimension is already fully covered (Coverage
    // 1.0 — never double-count); or no answered gap names this dimension.
    private static ScoredDimension Credit(ScoredDimension dim, string dimension, IReadOnlyList<AnsweredGap> gaps)
        => dim.Applicable && dim.Coverage < 1.0 && gaps.Any(g => g.Dimension == dimension)
            ? dim with { Coverage = 1.0 }
            : dim;

    private static IEnumerable<JsonElement> Arr(JsonElement el, string prop)
        => el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray() : Enumerable.Empty<JsonElement>();

    private static JsonElement Obj(JsonElement el, string prop)
        => el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v) ? v : default;

    private static string? Str(JsonElement el, string prop)
        => el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;

    private static decimal? Num(JsonElement el, string prop)
        => el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v)
           && v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d) ? d : null;
}
