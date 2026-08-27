// spec: dfes-companion-2026-07-11 (wave-3.11)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// FOUNDER DECISION 15 (2026-08-16) — <b>a filler answer earns zero extra, NEVER
/// negative.</b> "We are expecting clarity from the farmer, reward is the anchor or hook —
/// don't create a strict gate."
///
/// <para>Two halves, and the second is the load-bearing one:</para>
/// <list type="number">
///   <item>An unanchored answer does not fill the OBSERVATION bucket (spec Ruling 6). Its
///   words are still preserved on <c>question_events.response</c>; it simply earns
///   nothing.</item>
///   <item><b>Nothing loses a point.</b> Doctrine P7 and founder decision 6 (monotonic
///   non-decreasing, no exceptions) forbid subtraction outright, so the anchoring test is
///   applied ONLY on the answer route — <c>ObservationEvent.SourceQuestionId is not
///   null</c> — and only under wave-3.5's version guard. A VOLUNTEERED terse noticing
///   keeps the 8-character floor it has always had.</item>
/// </list>
///
/// <para><b>Why the negative proofs here are not vacuous.</b> A test asserting "filler
/// earns nothing" passes trivially against an extractor that credits no observation at
/// all. <see cref="An_anchored_answer_does_fill_the_observation_bucket"/> is the positive
/// control: the SAME wiring, the same answer route, an anchored text — and the bucket
/// fills. Without it every assertion below would be satisfied by a dead route.</para>
///
/// <para><b>Scope note.</b> The observations here are hand-stamped fixtures, which means
/// this file alone cannot tell you whether any production path sets
/// <c>SourceQuestionId</c> — for a while none did, and every assertion below still passed.
/// The route is proved separately, against the handler that writes it, in
/// <c>RecordQuestionEventHandlerTests.Sathis_gate_actually_evaluates_the_observation_this_handler_wrote</c>.
/// Only a VOLUNTEERED observation keeps the old 8-character floor, which is why this rule
/// is arithmetically incapable of lowering any existing day's number.</para>
/// </summary>
public sealed class ObservationAnchorTests
{
    private static readonly Guid LogId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid PlotId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid QuestionId = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly DateTime Now = new(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc);

    /// <summary>The founder's own three filler examples, verbatim.</summary>
    public const string FillerOk = "ठीक आहे";
    public const string FillerNothing = "काही नाही";
    public const string FillerAllCorrect = "सगळं बरोबर";

    // A real noticing, but a TERSE one: it clears the 8-character floor (9 chars) and
    // fails the anchoring test (two words). This is the string that proves the rule
    // cannot subtract — volunteered it still scores, answered it merely earns nothing.
    private const string TerseNoticing = "डाग वाढले";

    private const string SprayDay = """
    { "summary": "favarni keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // ── 1. the rule itself (spec required tests 11 and 12) ───────────────────

    [Theory]
    [InlineData(FillerOk)]
    [InlineData(FillerNothing)]
    [InlineData(FillerAllCorrect)]
    public void Filler_earns_no_observation(string text)
        => ObservationAnchor.IsAnchored(text).Should().BeFalse();

    [Theory]
    [InlineData("पानांवरचे डाग वाढले.")]
    [InlineData("कीड मागच्या वेळेपेक्षा कमी दिसली.")]
    [InlineData("खालच्या बाजूला ओलावा कमी होता.")]
    [InlineData("कालचे डाग आज वाढले नाहीत.")]   // a SPECIFIC "no change" IS an observation
    public void An_anchored_noticing_earns_the_bucket(string text)
        => ObservationAnchor.IsAnchored(text).Should().BeTrue();

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Silence_is_never_anchored(string? text)
        => ObservationAnchor.IsAnchored(text).Should().BeFalse();

    // ── 2. the rule is WIRED — the positive control ──────────────────────────

    /// <summary>
    /// The answer route, working. Everything below this asserts an absence; without this
    /// proof that the same route can produce a presence, each of them would pass against
    /// an extractor that ignored answer-sourced observations entirely.
    /// </summary>
    [Fact]
    public void An_anchored_answer_does_fill_the_observation_bucket()
    {
        var day = Run(SprayDay, Answered("कालचे डाग आज वाढले नाहीत."));

        Obs(day).Coverage.Should().Be(1.0);
        day.Signals.HasStructuredObservation.Should().BeTrue();
        day.Signals.HasMeaningfulObservation.Should().BeTrue();
    }

    // ── 3. filler earns ZERO EXTRA on the answer route ───────────────────────

    [Theory]
    [InlineData(FillerOk)]
    [InlineData(FillerNothing)]
    [InlineData(FillerAllCorrect)]
    public void A_filler_ANSWER_fills_nothing_and_still_costs_nothing(string text)
    {
        var day = Run(SprayDay, Answered(text));

        // Zero extra …
        Obs(day).Coverage.Should().Be(0.0, "spec Ruling 6 — filler does not fill the bucket");
        day.Signals.HasStructuredObservation.Should().BeFalse();
        day.Signals.HasMeaningfulObservation.Should().BeFalse(
            "or DayClassifier would read a filler answer as an ObservationDay");

        // … and never negative. OBS_FACET stays in the denominator at coverage 0, which
        // is exactly where it sat before he answered, so the /10 is unmoved.
        Obs(day).Applicable.Should().BeTrue();
        DayUnderstandingScore.From(day.Input)
            .Should().Be(DayUnderstandingScore.From(Run(SprayDay).Input),
                "P7 + decision 6 — answering may never shrink the number");
    }

    // ── 4. it CANNOT subtract: the volunteered route is untouched ────────────

    [Fact]
    public void A_volunteered_terse_observation_keeps_its_existing_points()
    {
        // P7 + decision 6: this rule may add, never subtract. `TerseNoticing` is the
        // adversarial case — it PASSES the old 8-character floor and FAILS the new
        // anchoring test — so if the rule leaked onto the volunteered route this is the
        // assertion that would break.
        ObservationAnchor.IsAnchored(TerseNoticing).Should().BeFalse(
            "the test below is only meaningful because this string fails the new rule");

        var before = Score(Run(SprayDay, Volunteered(TerseNoticing), anchoringEnabled: false));
        var after = Score(Run(SprayDay, Volunteered(TerseNoticing), anchoringEnabled: true));

        after.Should().BeGreaterThanOrEqualTo(before);
        Obs(Run(SprayDay, Volunteered(TerseNoticing), anchoringEnabled: true))
            .Coverage.Should().Be(1.0, "he volunteered it — the 8-character floor still governs");
    }

    [Theory]
    [InlineData(FillerOk)]
    [InlineData(FillerNothing)]
    [InlineData(FillerAllCorrect)]
    public void Even_a_VOLUNTEERED_filler_keeps_whatever_it_earned_before(string text)
    {
        // Two of the founder's three filler strings clear the 8-character floor. Said
        // unprompted they always earned OBS_FACET, and decision 6 is absolute — this
        // task must not take that back. Only the ANSWER route is governed.
        var expected = text.Trim().Length >= 8 ? 1.0 : 0.0;

        Obs(Run(SprayDay, Volunteered(text), anchoringEnabled: true))
            .Coverage.Should().Be(expected);
    }

    // ── 5. a day already scored under an older engine never moves ────────────

    [Fact]
    public void A_day_frozen_under_an_older_engine_is_not_re_judged()
    {
        // wave-3.5's version guard. A filler answer on a dfes-3 day keeps the dfes-3
        // answer, so a farmer's June number cannot move because we deployed in August.
        var frozen = Run(SprayDay, Answered(FillerNothing), scoredUnderVersion: "dfes-3");

        Obs(frozen).Coverage.Should().Be(1.0, "dfes-3 judged it by the 8-character floor");
    }

    // ── harness ──────────────────────────────────────────────────────────────
    private sealed record Scored(LensInput Input, LensScores Lenses, ClassifierSignals Signals);

    private static ScoredDimension Obs(Scored day) => day.Input.Possible!.Single(d => d.Name == "OBS_FACET");

    private static int Score(Scored day) => DayUnderstandingScore.From(day.Input)
        ?? throw new InvalidOperationException("the fixture day must be scoreable");

    /// <param name="anchoringEnabled">wave-3.5's <c>appliesNewRules</c>, expressed the
    /// only way a caller can express it: an unscored day (null) gets the new rules, a day
    /// already stamped with an older engine keeps the old ones.</param>
    private static Scored Run(
        string json,
        ObservationEvent? observation = null,
        bool anchoringEnabled = true,
        string? scoredUnderVersion = null)
    {
        using var doc = JsonDocument.Parse(json);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, signals) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData(
                [doc.RootElement],
                observation is null ? [] : [observation],
                ScoredUnderVersion: scoredUnderVersion ?? (anchoringEnabled ? null : "dfes-3")),
            probe,
            clientDatePlausible: true);

        return new Scored(input, probe.Scores, signals);
    }

    /// <summary>A noticing the farmer offered unprompted — SourceQuestionId null.</summary>
    private static ObservationEvent Volunteered(string text) => ObservationEvent.Create(
        Guid.NewGuid(), LogId, PlotId, ObservationNoteType.Observation, ObservationSeverity.Normal,
        ObservationSource.Voice, text, null, null, null, Now);

    /// <summary>The same noticing, arriving as the ANSWER to Sathi's question.</summary>
    private static ObservationEvent Answered(string text)
    {
        var o = Volunteered(text);
        o.ApplyInsightEntry(null, null, null, null, null, null, null, null, null, null, null, QuestionId);
        return o;
    }
}
