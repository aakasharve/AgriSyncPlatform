using System.Text.Json;
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
    // Dimension weights (mirror scoreVlog.ts BASE_WEIGHTS — engine constants, not DfesTuning).
    private const int W_WHAT = 20, W_DOSE = 20, W_SCOPE = 12, W_CARRIER = 10, W_COST = 12, W_WEATHER = 8;
    private const int W_OBS_FACET = 15, W_LEARN_FACET = 15; // structured-noticing pseudo-dims
    private const double Cf = 1.0;

    public sealed record DayData(IReadOnlyList<JsonElement> Roots, IReadOnlyList<ObservationEvent> Observations, int PlotCount);

    public static (LensInput Input, ClassifierSignals Signals) Build(DayData data, LensScoresProbe probeSink, bool clientDatePlausible)
    {
        var roots = data.Roots;

        // ── Execution lens ──────────────────────────────────────────────────
        var execution = new List<ScoredDimension>
        {
            Dim("WHAT", W_WHAT, CoverWhat(roots)),
            Dim("SCOPE", W_SCOPE, CoverScope(roots, data.PlotCount)),
            Dim("COST", W_COST, CoverCost(roots)),
        };
        AddIfApplicable(execution, "DOSE", W_DOSE, CoverDose(roots));      // input-op only
        AddIfApplicable(execution, "CARRIER", W_CARRIER, CoverCarrier(roots));

        // ── Insight lens ────────────────────────────────────────────────────
        var insight = new List<ScoredDimension> { Dim("WEATHER", W_WEATHER, CoverWeather(roots, data.Observations)) };
        var hasStructuredObs = HasStructuredObservation(data.Observations);
        if (hasStructuredObs) insight.Add(Dim("OBS_FACET", W_OBS_FACET, 1.0));

        // ── Learning lens ───────────────────────────────────────────────────
        var learning = new List<ScoredDimension>();
        var hasLearning = HasLearningFacet(data.Observations);
        if (hasLearning) learning.Add(Dim("LEARN_FACET", W_LEARN_FACET, 1.0));

        var input = new LensInput(execution, insight, learning);

        // ── Signals (unioned across all logs) ───────────────────────────────
        var hasWork = roots.Any(HasWork);
        var hasDisturbance = roots.Any(HasDisturbanceReason);
        var hasMeaningfulObs = hasStructuredObs || data.Observations.Any(o => o.TextRaw.Trim().Length >= 8);
        var hasExperiment = data.Observations.Any(o => !string.IsNullOrWhiteSpace(o.Hypothesis)
                                                       && !string.IsNullOrWhiteSpace(o.Evidence));
        var hasFollowup = data.Observations.Any(o => o.SourceQuestionId is not null
                                                    || !string.IsNullOrWhiteSpace(o.NextAction));
        var (declared, reasonCode) = DeclaredNoWork(roots);
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

    private static double CoverScope(IReadOnlyList<JsonElement> roots, int plotCount)
    {
        if (plotCount <= 1) return 1.0; // solo-farm waiver
        if (roots.Any(r => string.Equals(Str(Obj(r, "disturbance"), "scope"), "FULL_DAY", StringComparison.OrdinalIgnoreCase)))
            return 1.0;
        var events = roots.SelectMany(r =>
            Arr(r, "cropActivities").Concat(Arr(r, "inputs")).Concat(Arr(r, "labour"))
                .Concat(Arr(r, "machinery")).Concat(Arr(r, "activityExpenses"))).ToList();
        if (events.Count == 0) return 0.0;
        var named = events.Count(e => !string.IsNullOrWhiteSpace(Str(e, "targetPlotName")));
        if (named == 0) return 0.0;
        return named == events.Count ? 1.0 : 0.5;
    }

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
    private static bool HasStructuredObservation(IReadOnlyList<ObservationEvent> obs)
        => obs.Any(o => !string.IsNullOrWhiteSpace(o.Observation) || !string.IsNullOrWhiteSpace(o.Change)
            || !string.IsNullOrWhiteSpace(o.Comparison) || !string.IsNullOrWhiteSpace(o.Challenge)
            || !string.IsNullOrWhiteSpace(o.Uncertainty)
            || (o.NoteType == ObservationNoteType.Observation && o.TextRaw.Trim().Length >= 8));

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

    private static ScoredDimension Dim(string name, int weight, double coverage)
        => new(name, weight, Applicable: true, Coverage: coverage, ConfidenceFactor: Cf);

    private static ScoredDimension Dim(string name, int weight, Cover c)
        => new(name, weight, c.Applicable, c.Value, Cf);

    private static void AddIfApplicable(List<ScoredDimension> list, string name, int weight, Cover c)
        => list.Add(Dim(name, weight, c));

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
