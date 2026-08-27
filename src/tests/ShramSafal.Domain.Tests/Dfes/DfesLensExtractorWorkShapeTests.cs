// spec: dfes-companion-2026-07-11 (wave-3.4)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// FOUNDER DECISION 14 (2026-08-16) — <b>classify the work by the PRODUCT, never by a
/// method flag.</b>
///
/// <para><b>The gap this closes.</b> A day owed the water/carrier question the moment it
/// carried any <c>inputs[]</c> row or a spray/fertigation activity title. So a farmer who
/// broadcast dry DAP by hand was asked how much water he used — a question his day cannot
/// answer, and one he can therefore never fill. <c>inputs[].method</c> was read nowhere,
/// and the product was read nowhere either.</para>
///
/// <para><b>Why this is NOT the bypass the 2026-08-13 note forbade.</b> On 2026-08-13 the
/// founder was asked whether a soil-applied fertiliser should be exempt from the water
/// question and answered "keep asking" — which forbade a <c>method == "Soil"</c> bypass.
/// Decision 14 does not restore that bypass; it removes the method flag from the decision
/// entirely. The two proofs that separate them live below:
/// <see cref="WaterSoluble_MKP_still_owes_water_despite_method_Soil"/> (a WSF grade owes
/// water even when the flag says Soil) and
/// <see cref="An_unrecognised_product_keeps_asking"/> (anything we do not recognise keeps
/// the old behaviour). Under a method bypass BOTH of those days would go silent.</para>
///
/// <para><b>The founder's own example is self-classifying.</b> He said a farmer might say
/// "0 52 34 दिल" — an NPK grade, given with no flag anywhere. A recognised grade is
/// water-soluble by definition, so the grade alone answers the question. Nothing had to be
/// tagged, and the AI was not asked to do anything new.</para>
///
/// <para><b>Doctrine P4.</b> An unrecognised product resolves to <c>Unknown</c> and keeps
/// asking. That will be most logs until the catalogue grows, and it is the correct default:
/// guessing a product dry would silently retire a real question.</para>
/// </summary>
public sealed class DfesLensExtractorWorkShapeTests
{
    // He broadcast a bag of DAP by hand. Dry granular — there is no tank, no water,
    // and no honest answer to "how much water did you use?".
    private const string DryFertiliserDay = """
    { "summary": "DAP ek poti takli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "Fertilizer DAP" } ],
      "inputs": [ { "id": "in-1", "method": "Soil", "productName": "DAP",
                    "mix": [ { "id": "m-1", "productName": "DAP", "dose": 50, "unit": "kg" } ] } ],
      "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // The founder's own example. "0 52 34" is MKP — a water-soluble fertiliser that only
    // exists dissolved. The method flag says "Soil"; the PRODUCT says water.
    private const string WaterSolubleDay = """
    { "summary": "00:52:34 dila", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "Fertilizer application" } ],
      "inputs": [ { "id": "in-1", "method": "Soil", "productName": "0-52-34",
                    "mix": [ { "id": "m-1", "productName": "0-52-34", "npkGrade": "0-52-34",
                               "dose": 1, "unit": "kg" } ] } ],
      "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // A product the catalogue has never heard of. We do not know whether it is a powder,
    // a paste or a liquid — so we do not decide.
    private const string UnknownProductDay = """
    { "summary": "kaay tari takla", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [ { "id": "in-1", "method": "Spray", "productName": "Vardaan Super Gold",
                    "mix": [ { "id": "m-1", "productName": "Vardaan Super Gold" } ] } ],
      "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // Water only. No product was applied, so there is no dose to state — the BOUNDARY
    // that proves this change did not widen applicability anywhere.
    private const string IrrigationOnlyDay = """
    { "summary": "paani dila", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "irrigation" } ],
      "irrigation": [ { "method": "drip", "durationHours": 2, "source": "borewell" } ],
      "inputs": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // ── the change itself ────────────────────────────────────────────────────

    [Fact]
    public void DryFertiliserDay_never_owes_water()
        => Dim(Run(DryFertiliserDay), "CARRIER").Applicable.Should().BeFalse(
            "dry granular carries no water — asking charges the farmer for a question his day "
            + "cannot answer (founder decision 14, 2026-08-16)");

    [Fact]
    public void DryFertiliserDay_still_owes_the_dose()
        => Dim(Run(DryFertiliserDay), "DOSE").Applicable.Should().BeTrue(
            "a dry fertiliser still HAS a dose — decision 14 retires the water question only");

    // ── the two proofs that this is not a method bypass ──────────────────────

    [Fact]
    public void WaterSoluble_MKP_still_owes_water_despite_method_Soil()
        => Dim(Run(WaterSolubleDay), "CARRIER").Applicable.Should().BeTrue(
            "0:52:34 is water-soluble by definition, so the grade alone answers the question; "
            + "a method==\"Soil\" bypass would wrongly silence this day");

    [Fact]
    public void An_unrecognised_product_keeps_asking()
        => Dim(Run(UnknownProductDay), "CARRIER").Applicable.Should().BeTrue(
            "Unknown falls back to today's behaviour — P4, never guess a farmer's day away");

    // ── the boundary, unchanged ──────────────────────────────────────────────

    [Fact]
    public void IrrigationOnlyDay_never_owes_a_product_dose()
        => Dim(Run(IrrigationOnlyDay), "DOSE").Applicable.Should().BeFalse(
            "nothing was applied, so there is no dose — the boundary must not move");

    [Fact]
    public void IrrigationOnlyDay_still_owes_its_carrier()
        => Dim(Run(IrrigationOnlyDay), "CARRIER").Applicable.Should().BeTrue(
            "he irrigated: HOW he delivered the water is a real question about real work, and "
            + "the product rule must not reach the pure-irrigation branch at all");

    // ── the version guard (wave-3.5) governs this change too ─────────────────

    [Fact]
    public void A_dfes3_dry_fertiliser_day_keeps_asking_because_its_score_is_frozen()
    {
        // The guard is what stops a June number moving because we deployed in August.
        // A day already scored under dfes-3 must keep the dfes-3 roster, water question
        // and all; only a day this engine may (re)score gets decision 14.
        Dim(Run(DryFertiliserDay, scoredUnder: "dfes-3"), "CARRIER").Applicable.Should().BeTrue(
            "a frozen day keeps its original denominator — see appliesNewRules in DfesLensExtractor");

        Dim(Run(DryFertiliserDay, scoredUnder: DfesTuning.ScoreEngineVersion), "CARRIER")
            .Applicable.Should().BeFalse("a day already on this engine gets the new rules");
    }

    // ── harness ──────────────────────────────────────────────────────────────
    private static LensInput Run(string json, string? scoredUnder = null)
    {
        using var doc = JsonDocument.Parse(json);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData(
                [doc.RootElement], [], null, null, null, null, null, scoredUnder),
            probe,
            clientDatePlausible: true);

        return input;
    }

    private static ScoredDimension Dim(LensInput input, string name)
        => input.Possible!.Single(d => d.Name == name);
}
