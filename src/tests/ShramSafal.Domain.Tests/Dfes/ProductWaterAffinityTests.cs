// spec: dfes-companion-2026-07-11 (wave-3.4)
using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// FOUNDER DECISION 14 (2026-08-16) — the resolution order, step by step.
/// <see cref="DfesLensExtractorWorkShapeTests"/> proves what a DAY owes; this proves what a
/// single PRODUCT resolves to, including the two branches a day-shaped test cannot reach
/// (the grape-lexicon role and the paste exception).
/// </summary>
public sealed class ProductWaterAffinityTests
{
    // ── step 1: a recognised NPK grade is water-soluble by definition ─────────

    [Theory]
    [InlineData("0-52-34")]   // MKP — the founder's own "0 52 34"
    [InlineData("0:52:34")]   // the colon form Sarvam produces for a spoken grade
    [InlineData("19-19-19")]
    [InlineData("13-0-45")]
    public void A_known_grade_is_water_carried(string grade)
        => ProductWaterAffinity.Resolve(grade, null).Should().Be(WaterAffinity.WaterCarried);

    [Fact]
    public void The_grade_is_read_from_the_product_name_too()
        => ProductWaterAffinity.Resolve(null, "0-52-34").Should().Be(WaterAffinity.WaterCarried,
            "a farmer who says '0 52 34 दिल' names the grade AS the product — that must "
            + "self-classify with no flag anywhere, which is decision 14's whole point");

    [Fact]
    public void An_unknown_grade_shape_is_not_assumed_soluble()
        => ProductWaterAffinity.Resolve("7-7-7", null).Should().Be(WaterAffinity.Unknown,
            "grade-SHAPED is not the same as recognised — membership of NpkGradeTable is "
            + "what carries the agronomic claim, not the pattern");

    [Fact]
    public void A_clock_time_is_not_a_grade()
        => ProductWaterAffinity.Resolve(null, "5:30 वाजता").Should().Be(WaterAffinity.Unknown,
            "the shape regex is anchored, so a sentence containing digits is never a grade");

    // ── step 2: a recognised grape input uses its agronomic role ─────────────

    [Theory]
    [InlineData("Bavistin")]      // systemic fungicide
    [InlineData("bavisteen")]     // an STT mangling the lexicon already carries
    [InlineData("Alphamethrin")]  // pyrethroid insecticide
    [InlineData("GA3")]           // gibberellin PGR
    [InlineData("मँकोजेब")]         // Devanagari alias
    public void A_sprayed_grape_input_is_water_carried(string productName)
        => ProductWaterAffinity.Resolve(null, productName).Should().Be(WaterAffinity.WaterCarried);

    [Fact]
    public void A_paste_is_dry_because_it_is_painted_on_not_sprayed()
        => ProductWaterAffinity.Resolve(null, "Dormex").Should().Be(WaterAffinity.Dry,
            "Dormex is painted onto dormant cane — its role is a 'dormancy-break paste', "
            + "and there is no tank of water to ask about");

    [Fact]
    public void A_near_miss_on_a_lexicon_name_is_not_matched_here()
        => ProductWaterAffinity.Resolve(null, "Bavistan Gold Plus").Should().Be(WaterAffinity.Unknown,
            "GrapeInputLexicon's fuzzy matcher exists to RESCUE a mangled name into a product; "
            + "this rule stays exact, because a wrong match would retire a real question");

    // ── step 3: the founder's `fertiliser rule = dry granular` ───────────────

    [Theory]
    [InlineData("DAP")]
    [InlineData("dap")]
    [InlineData("urea")]
    [InlineData("MOP")]
    [InlineData("FYM")]
    [InlineData("SSP")]
    [InlineData("युरिया")]
    public void A_named_dry_granular_is_dry(string productName)
        => ProductWaterAffinity.Resolve(null, productName).Should().Be(WaterAffinity.Dry);

    // ── step 4: everything else keeps asking (P4) ────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Vardaan Super Gold")]
    public void Anything_unrecognised_is_Unknown_and_keeps_asking(string? productName)
        => ProductWaterAffinity.Resolve(null, productName).Should().Be(WaterAffinity.Unknown,
            "doctrine P4 — guessing a product dry silently removes the farmer's only route "
            + "to fill that bucket; leaving the question costs him nothing he did not already have");

    // ── the ordering itself: the grade OUTRANKS the name ─────────────────────

    [Fact]
    public void A_known_grade_beats_a_dry_sounding_name()
        => ProductWaterAffinity.Resolve("0-52-34", "DAP").Should().Be(WaterAffinity.WaterCarried,
            "the resolution order is fixed: a recognised WSF grade is decided at step 1 and "
            + "the dry-granular list at step 3 never gets to overturn it");
}
