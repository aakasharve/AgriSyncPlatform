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
    public sealed record DayData(
        IReadOnlyList<JsonElement> Roots,
        IReadOnlyList<ObservationEvent> Observations,
        IReadOnlyList<JsonElement>? PersistedRoots = null);

    public static (LensInput Input, ClassifierSignals Signals) Build(DayData data, LensScoresProbe probeSink, bool clientDatePlausible)
    {
        var roots = data.Roots;
        var persisted = data.PersistedRoots ?? [];
        var hasStructuredObs = HasStructuredObservation(data.Observations);
        var hasLearning = HasLearningFacet(data.Observations);

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
        var doseOwed = Dim("DOSE", W_DOSE, Best(OwedDose(roots), OwedDose(persisted)));
        var carrierOwed = Dim("CARRIER", W_CARRIER, Best(OwedCarrier(roots), OwedCarrier(persisted)));

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
        var possible = new List<ScoredDimension>
        {
            what, cost, doseOwed, carrierOwed, weather, obsFacet, learnFacet,
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

    // FOUNDER DECISION 2026-08-13 — an input application owes the water/carrier
    // question even when it was applied to the SOIL (method "Soil", no spray tank).
    // The founder was asked directly whether a soil-applied fertiliser should be
    // exempt and answered NO: keep asking. Do NOT add a `method == "Soil"` bypass
    // here — it looks like an obvious cleanup and it would reverse an explicit
    // decision. If it is ever revisited, that is a founder call, not a refactor.
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

    private static Cover OwedCarrier(IReadOnlyList<JsonElement> roots)
    {
        var described = CoverCarrier(roots);
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
