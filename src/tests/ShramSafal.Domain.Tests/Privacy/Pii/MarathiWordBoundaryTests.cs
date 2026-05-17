// spec: data-principle-spine-2026-05-05/10.1
using FluentAssertions;
using ShramSafal.Domain.Privacy.Pii;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 (OQ-10) — word-boundary
/// behaviour on Devanagari text. .NET's <c>\b</c> regex anchor has
/// CLR-version drift around Devanagari classification; we use a
/// custom IsWordCharacter predicate inside
/// <see cref="WorkerNameDetector"/> instead. These cases prove the
/// detector matches whole-token names and does NOT match name
/// substrings inside larger words. Eight cases per OQ-10 acceptance.
/// </summary>
public sealed class MarathiWordBoundaryTests
{
    private const decimal AutoRedactThreshold = 0.85m;
    private const decimal DiscardThreshold = 0.3m;

    private static WorkerNameDetector NewDetector() =>
        new(
            names: new HashSet<string>(new[] { "रामू", "Ravi" }, StringComparer.Ordinal),
            markers: new HashSet<string>(new[] { "मजूर", "worker" }, StringComparer.Ordinal));

    [Fact]
    public void Case_1_name_at_start_of_sentence()
    {
        var d = NewDetector();
        var result = d.Detect("रामू मजूर आला.", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(1);
        result.MarkerCount.Should().Be(1);
        result.RedactedText.Should().StartWith("[WORKER_1]");
    }

    [Fact]
    public void Case_2_name_at_end_of_sentence()
    {
        var d = NewDetector();
        var result = d.Detect("आज मजूर आला रामू", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(1);
        result.RedactedText.Should().EndWith("[WORKER_1]");
    }

    [Fact]
    public void Case_3_name_mid_sentence()
    {
        var d = NewDetector();
        var result = d.Detect("आज रामू माझ्याकडे मजूर म्हणून आला.", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(1);
        result.RedactedText.Should().Contain("[WORKER_1]");
        result.RedactedText.Should().NotContain("रामू");
    }

    [Fact]
    public void Case_4_name_before_devanagari_danda()
    {
        var d = NewDetector();
        var result = d.Detect("मजूर आला रामू। काम केले।", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(1);
        result.RedactedText.Should().Contain("[WORKER_1]।");
    }

    [Fact]
    public void Case_5_name_after_devanagari_danda()
    {
        var d = NewDetector();
        var result = d.Detect("काम केले।रामू मजूर होता.", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(1);
        result.RedactedText.Should().Contain("।[WORKER_1]");
    }

    [Fact]
    public void Case_6_name_before_zwj()
    {
        var d = NewDetector();
        // ZWJ (U+200D) between name and next ligature-letter — should NOT
        // match because the ZWJ is a word-internal character per our
        // tokenizer (would create "रामू‍मजूर" as one token, which is
        // not the dictionary entry "रामू"). Detector should report 0 names.
        var zwj = "‍";
        var result = d.Detect($"रामू{zwj}मजूर आला.", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(0);
    }

    [Fact]
    public void Case_7_name_after_zwj()
    {
        var d = NewDetector();
        // Symmetric: रामू preceded by ZWJ glued to another character is
        // not the bare token "रामू". 0 matches expected.
        var zwj = "‍";
        var result = d.Detect($"मजूर{zwj}रामू.", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(0);
    }

    [Fact]
    public void Case_8_mixed_devanagari_and_latin_name_tokens_both_match()
    {
        var d = NewDetector();
        // Both "रामू" (Devanagari) and "Ravi" (Latin) are in the
        // dictionary; both should be matched and redacted independently.
        var result = d.Detect("Ravi ji and रामू both came as worker", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(2);
        result.MarkerCount.Should().Be(1);
        result.RedactedText.Should().Contain("[WORKER_1]");
        result.RedactedText.Should().Contain("[WORKER_2]");
        result.RedactedText.Should().NotContain("रामू");
        result.RedactedText.Should().NotContain("Ravi");
    }

    [Fact]
    public void Substring_inside_longer_word_does_not_match()
    {
        var d = NewDetector();
        // "रामूचे" (=Ramu's) is one token containing "रामू" as a
        // substring. The whole-token boundary check MUST reject it —
        // otherwise we would over-redact possessives / inflections.
        var result = d.Detect("रामूचे काम मजूर करत आहेत.", AutoRedactThreshold, DiscardThreshold);

        // "रामूचे" is one token and does not equal "रामू" in the
        // dictionary; the detector should see 0 names.
        result.NameCount.Should().Be(0);
    }
}
