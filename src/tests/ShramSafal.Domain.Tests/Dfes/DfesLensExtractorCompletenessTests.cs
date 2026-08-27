using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11. The extractor's COMPLETENESS ROSTER — the
/// fixed denominator the farmer-facing /10 divides by — over real day shapes.
///
/// <para>Two things must both hold, and they pull against each other:</para>
/// <list type="number">
///   <item>Every dimension that COULD apply to the day is in the denominator even
///   when the farmer said nothing about it — otherwise the denominator shrinks to
///   whatever he mentioned and mentioning more can score less.</item>
///   <item>A dimension that CANNOT apply to the work performed (a pesticide DOSE on
///   a day he only irrigated) is in NEITHER sum — the number is never charged
///   against work he did not do.</item>
/// </list>
/// </summary>
public sealed class DfesLensExtractorCompletenessTests
{
    private static readonly Guid LogId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid PlotId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateTime Now = new(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc);

    // ── day shapes (canonical AgriLogResponse wire, as the extractor reads it) ──

    // He logged that he sprayed. Nothing else.
    private const string BareWorkDay = """
    { "summary": "kaam kela", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // Sathi asked "which product?" and he answered — but gave no dose.
    private const string ProductNamedNoDose = """
    { "summary": "kaam kela", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [ { "productName": "MKP", "mix": [ { "productName": "MKP" } ] } ],
      "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // The founder's worked example: Execution 48, Insight 100, Learning N/A.
    private const string ProductNamedPlusWeather = """
    { "summary": "kaam kela", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [ { "productName": "MKP", "mix": [ { "productName": "MKP" } ] } ],
      "disturbance": { "reason": "paus aala", "cause": "rain", "scope": "DELAYED" },
      "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // A genuinely detailed day: product + dose + hired labour with a rate and a total.
    private const string RichSprayDay = """
    { "summary": "sprayed and noticed leaf curl", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [ { "productName": "MKP", "mix": [ { "productName": "MKP", "dose": 4, "unit": "kg" } ] } ],
      "labour": [ { "wagePerPerson": 350, "totalCost": 700 } ],
      "irrigation": [], "machinery": [], "activityExpenses": [] }
    """;

    // Water only — no input operation happened, so DOSE cannot apply.
    private const string IrrigationOnlyDay = """
    { "summary": "paani dila", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "irrigation" } ],
      "irrigation": [ { "method": "drip", "durationHours": 2, "source": "borewell" } ],
      "inputs": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // Pruning. No spray, no fertiliser, no water — nothing was applied, so there is
    // no dose to state and nothing for water to carry. The BOUNDARY of decision B.
    private const string PruningOnlyDay = """
    { "summary": "chhatani keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "pruning" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // The founder's own example, made scoreable: everything he COULD say about a
    // spraying day is said — the work, the labour and what it cost, why the day was
    // disrupted, what he noticed — EXCEPT which product went in the tank.
    private const string WellDescribedSprayDay = """
    { "summary": "sprayed the north block", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "labour": [ { "wagePerPerson": 350, "totalCost": 700 } ],
      "disturbance": { "reason": "paus aala", "cause": "rain", "scope": "DELAYED" },
      "inputs": [], "irrigation": [], "machinery": [], "activityExpenses": [] }
    """;

    // The very same day, one sentence longer: he answered "which product?".
    private const string WellDescribedSprayDayWithProduct = """
    { "summary": "sprayed the north block", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "labour": [ { "wagePerPerson": 350, "totalCost": 700 } ],
      "disturbance": { "reason": "paus aala", "cause": "rain", "scope": "DELAYED" },
      "inputs": [ { "productName": "Confidor", "mix": [ { "productName": "Confidor" } ] } ],
      "irrigation": [], "machinery": [], "activityExpenses": [] }
    """;

    // ── 1. the always-possible dimensions are always in the denominator ───────

    [Fact]
    public void Roster_always_carries_the_five_always_possible_dimensions()
    {
        // He said nothing about cost, weather, what he noticed or what he learned.
        // All four must still be POSSIBLE — that is what he can chase.
        var day = Run(BareWorkDay);

        var possible = day.Input.Possible.Should().NotBeNull().And.Subject.ToList();
        possible.Where(d => d.Applicable).Select(d => d.Name)
            .Should().Contain(["WHAT", "COST", "WEATHER", "OBS_FACET", "LEARN_FACET"]);
        possible.Single(d => d.Name == "OBS_FACET").Coverage.Should().Be(0.0);
        possible.Single(d => d.Name == "LEARN_FACET").Coverage.Should().Be(0.0);
    }

    [Fact]
    public void Roster_records_the_facets_as_covered_once_the_farmer_shares_them()
    {
        var day = Run(BareWorkDay, Note("leaf curl on the north block"), Tip("spray before noon"));

        var possible = day.Input.Possible!.ToList();
        possible.Single(d => d.Name == "OBS_FACET").Coverage.Should().Be(1.0);
        possible.Single(d => d.Name == "LEARN_FACET").Coverage.Should().Be(1.0);
    }

    // ── 2. no fabricated denominator ─────────────────────────────────────────

    [Fact]
    public void IrrigationOnlyDay_marks_DOSE_not_applicable_so_it_is_never_charged()
    {
        var day = Run(IrrigationOnlyDay);

        var dose = day.Input.Possible!.Single(d => d.Name == "DOSE");
        dose.Applicable.Should().BeFalse("no input operation happened — there is no dose to describe");

        // CARRIER, by contrast, DOES apply: he irrigated, so how he delivered the
        // water is a real question about work he really did.
        day.Input.Possible!.Single(d => d.Name == "CARRIER").Applicable.Should().BeTrue();

        // Proof it costs him nothing: removing the N/A dimension leaves the score identical.
        var withoutDose = new LensInput([], [], [], [.. day.Input.Possible!.Where(d => d.Name != "DOSE")]);
        DayUnderstandingScore.From(withoutDose).Should().Be(DayUnderstandingScore.From(day.Input));
    }

    /// <summary>
    /// FOUNDER DECISION B (2026-08-13, <c>dfes-3</c>): a spraying day owes DOSE and
    /// CARRIER from the OPERATION, before any product is named. This test asserts the
    /// opposite of what it did under <c>dfes-2</c> — that is the decision, not a
    /// regression. See <see cref="NamingTheProduct_can_never_lower_the_number"/> for
    /// why the old shape was untenable.
    /// </summary>
    [Fact]
    public void SprayDay_owes_dose_and_carrier_before_any_product_is_named()
    {
        var day = Run(BareWorkDay); // "I sprayed." — nothing else

        var dose = day.Input.Possible!.Single(d => d.Name == "DOSE");
        var carrier = day.Input.Possible!.Single(d => d.Name == "CARRIER");

        dose.Applicable.Should().BeTrue("a spray happened, so there IS a dose he could tell us");
        carrier.Applicable.Should().BeTrue("a spray happened, so there IS water he could tell us about");
        dose.Coverage.Should().Be(0.0, "he has not described it — owed is not the same as credited");
        carrier.Coverage.Should().Be(0.0);
    }

    /// <summary>The BOUNDARY of decision B: a day with no application at all owes
    /// NEITHER. The farmer is never charged for work he did not do.</summary>
    [Fact]
    public void NonApplicationDay_owes_neither_dose_nor_carrier()
    {
        var day = Run(PruningOnlyDay);

        day.Input.Possible!.Single(d => d.Name == "DOSE").Applicable.Should().BeFalse();
        day.Input.Possible!.Single(d => d.Name == "CARRIER").Applicable.Should().BeFalse();

        // And it costs him nothing: dropping both leaves the number identical.
        var withoutInputDims = new LensInput([], [], [],
            [.. day.Input.Possible!.Where(d => d.Name is not ("DOSE" or "CARRIER"))]);
        DayUnderstandingScore.From(withoutInputDims).Should().Be(DayUnderstandingScore.From(day.Input));
    }

    /// <summary>
    /// FOUNDER DECISION (2026-08-13, <c>dfes-3</c>): <c>LEARN_FACET</c> is still
    /// RECORDED in the roster — the day's picture stays complete — but takes no part
    /// in the /10 while no production code path can produce its signal. Deleting it
    /// from the roster entirely would have hidden the debt; leaving it in the
    /// denominator capped every farmer at ~85/100 before he opened the app.
    /// </summary>
    [Fact]
    public void LearnFacet_is_recorded_in_the_roster_but_takes_no_part_in_the_number()
    {
        var day = Run(BareWorkDay);

        day.Input.Possible!.Should().Contain(d => d.Name == "LEARN_FACET",
            "the dimension keeps its definition — this is a participation change, not a deletion");

        var withoutLearn = new LensInput([], [], [],
            [.. day.Input.Possible!.Where(d => d.Name != "LEARN_FACET")]);
        DayUnderstandingScore.From(day.Input).Should().Be(
            DayUnderstandingScore.From(withoutLearn),
            "an unearnable dimension is in NEITHER the numerator nor the denominator");
    }

    // ── 3. the lens lists (classifier inputs) are untouched by this change ────

    [Fact]
    public void LensLists_keep_their_pre_change_shape_so_classification_is_unaffected()
    {
        var day = Run(BareWorkDay);

        day.Input.Execution.Select(d => d.Name).Should().Equal("WHAT", "COST", "DOSE", "CARRIER");
        day.Input.Insight.Select(d => d.Name).Should().Equal("WEATHER");
        day.Input.Learning.Should().BeEmpty("no learning signal → the lens does not exist");
        day.Lenses.LearningScore.Should().BeNull("an absent lens stays UNKNOWN, never a 0");
    }

    [Fact]
    public void ObservationAndLearning_enter_their_lenses_only_when_the_farmer_shares_them()
    {
        var day = Run(BareWorkDay, Note("leaf curl on the north block"), Tip("spray before noon"));

        day.Input.Insight.Select(d => d.Name).Should().Equal("WEATHER", "OBS_FACET");
        day.Input.Learning.Select(d => d.Name).Should().Equal("LEARN_FACET");
        day.Lenses.LearningScore.Should().Be(100);
    }

    // ── 4. the reachable defect: naming the product used to cost him a point ──

    [Fact]
    public void AnsweringWhichProduct_lowered_the_old_number_and_no_longer_does()
    {
        var before = Run(BareWorkDay);                 // "I sprayed."
        var after = Run(ProductNamedNoDose);           // "...with MKP."  ← he answered Sathi

        var legacyBefore = LegacyDayUnderstandingRollup.MeanOverApplicableLenses(before.Lenses);
        var legacyAfter = LegacyDayUnderstandingRollup.MeanOverApplicableLenses(after.Lenses);

        legacyAfter.Should().BeLessThan(
            legacyBefore!.Value,
            "the OLD engine punished him for naming the product: DOSE/CARRIER joined the "
            + "Execution lens's denominator faster than his answer filled it");

        DayUnderstandingScore.From(after.Input).Should().BeGreaterThanOrEqualTo(
            DayUnderstandingScore.From(before.Input)!.Value,
            "the new engine already counted DOSE/CARRIER as possible the moment the input "
            + "operation was known, so his answer can only add to the numerator");
    }

    /// <summary>
    /// THE acceptance criterion for founder decision B, on the founder's own example.
    /// A well-described spraying day, then the SAME day with the product named.
    ///
    /// <para>Under <c>dfes-2</c> this scored 10 → 8: DOSE and CARRIER only entered the
    /// denominator once a product appeared, so answering "which product?" added 30
    /// points of denominator and 10 of numerator. He told us more and the number fell.
    /// Under <c>dfes-3</c> the denominator is set by the OPERATION, so it does not move
    /// and his answer can only add: 6 → 8.</para>
    ///
    /// <para>This test FAILS on the pre-change extractor (8 is not ≥ 10).</para>
    /// </summary>
    [Fact]
    public void NamingTheProduct_can_never_lower_the_number()
    {
        var silentAboutProduct = Run(WellDescribedSprayDay, Note("leaf curl on the north block"));
        var named = Run(WellDescribedSprayDayWithProduct, Note("leaf curl on the north block"));

        var before = DayUnderstandingScore.From(silentAboutProduct.Input);
        var after = DayUnderstandingScore.From(named.Input);

        after.Should().BeGreaterThanOrEqualTo(
            before!.Value,
            "answering Sathi's 'which product?' is the farmer being helpful — it may NEVER cost him the number");

        // The denominator is what must not move; the numerator is what his answer fills.
        Owed(named.Input).Should().Be(Owed(silentAboutProduct.Input),
            "naming a product does not change what the day OWES — the spray already did");

        before.Should().Be(6);
        after.Should().Be(8);

        static double Owed(LensInput input)
            => input.Possible!.Where(d => d.Applicable && d.Name != "LEARN_FACET").Sum(d => (double)d.Weight);
    }

    /// <summary>Kept from <c>dfes-2</c>. Since LEARN_FACET now takes no part in the
    /// /10, the guarantee is trivially satisfied for it today — the test stays as the
    /// tripwire for the day a learning signal becomes earnable again.</summary>
    [Fact]
    public void FirstLearningAnswer_never_lowers_the_number_on_a_real_day()
    {
        foreach (var shape in new[] { BareWorkDay, ProductNamedNoDose, ProductNamedPlusWeather, RichSprayDay })
        {
            var before = DayUnderstandingScore.From(Run(shape).Input);
            var after = DayUnderstandingScore.From(Run(shape, Tip("spray before noon")).Input);

            after.Should().BeGreaterThanOrEqualTo(before!.Value, "shape: {0}", shape);
        }
    }

    // ── 5. the before/after shift, recorded for the founder ──────────────────

    /// <summary>
    /// The honest-number shift, kept current as the receipt. <c>oldScore</c> is the
    /// original mean-over-applicable-lenses rollup (untouched by any of this — it
    /// reads the LENS scores, and those were deliberately left alone so the reward
    /// economy does not move). <c>newScore</c> is the <c>dfes-3</c> /10.
    ///
    /// <para>Both directions are visible here and both are intended. Dropping the
    /// unearnable LEARN_FACET from the denominator RAISES days (irrigation-only 4→5,
    /// rich-spray 7→8). Charging DOSE/CARRIER from the operation LOWERS the days that
    /// applied something and described none of it (bare-work-day 3→2). No weight
    /// changed; what moved is which questions the day is asked.</para>
    ///
    /// <para>Five differently-shaped days, four different numbers — the number moves
    /// with the day, which was the whole complaint.</para>
    /// </summary>
    [Theory]
    [InlineData("bare-work-day", 3, 2)]
    [InlineData("product-named-no-dose", 2, 4)]
    [InlineData("product-named-plus-weather", 7, 4)]
    [InlineData("rich-spray-day", 7, 8)]
    [InlineData("irrigation-only-day", 4, 5)]
    [InlineData("pruning-only-day", 3, 4)]
    public void Before_and_after_the_engine_change(string shape, int oldScore, int newScore)
    {
        var day = Shape(shape);

        LegacyDayUnderstandingRollup.MeanOverApplicableLenses(day.Lenses).Should().Be(
            oldScore, "the mean-over-applicable-lenses rollup scored '{0}' at {1}", shape, oldScore);
        DayUnderstandingScore.From(day.Input).Should().Be(
            newScore, "covered ÷ possible weight scores '{0}' at {1}", shape, newScore);
    }

    private static Scored Shape(string key) => key switch
    {
        "bare-work-day" => Run(BareWorkDay),
        "product-named-no-dose" => Run(ProductNamedNoDose),
        "product-named-plus-weather" => Run(ProductNamedPlusWeather),
        "rich-spray-day" => Run(RichSprayDay, Note("leaf curl on the north block")),
        "irrigation-only-day" => Run(IrrigationOnlyDay),
        "pruning-only-day" => Run(PruningOnlyDay),
        _ => throw new ArgumentOutOfRangeException(nameof(key), key, "unknown day shape"),
    };

    // ── harness ──────────────────────────────────────────────────────────────
    private sealed record Scored(LensInput Input, LensScores Lenses, ClassifierSignals Signals);

    private static Scored Run(string json, params ObservationEvent[] observations)
    {
        // The LensInput holds only computed numbers, so the JsonDocument can go.
        using var doc = JsonDocument.Parse(json);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, signals) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData([doc.RootElement], observations),
            probe,
            clientDatePlausible: true);

        return new Scored(input, probe.Scores, signals);
    }

    private static ObservationEvent Note(string text) => ObservationEvent.Create(
        Guid.NewGuid(), LogId, PlotId, ObservationNoteType.Observation, ObservationSeverity.Normal,
        ObservationSource.Voice, text, null, null, null, Now);

    private static ObservationEvent Tip(string text) => ObservationEvent.Create(
        Guid.NewGuid(), LogId, PlotId, ObservationNoteType.Tip, ObservationSeverity.Normal,
        ObservationSource.Voice, text, null, null, null, Now);
}
