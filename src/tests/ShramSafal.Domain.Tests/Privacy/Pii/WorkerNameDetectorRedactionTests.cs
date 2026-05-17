// spec: data-principle-spine-2026-05-05/10.1
using FluentAssertions;
using ShramSafal.Domain.Privacy.Pii;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 (OQ-4) — anti-reverse-
/// engineering posture: positional [WORKER_N] tokens MUST be assigned
/// per-transcript with no cross-transcript namespace. Two transcripts
/// can each have a [WORKER_1] referring to two different humans.
/// </summary>
public sealed class WorkerNameDetectorRedactionTests
{
    private const decimal AutoRedactThreshold = 0.85m;
    private const decimal DiscardThreshold = 0.3m;

    private static WorkerNameDetector NewDetector() =>
        new(
            names: new HashSet<string>(
                new[] { "रामू", "सीता", "रवि", "सुनील", "गणेश" }, StringComparer.Ordinal),
            markers: new HashSet<string>(
                new[] { "मजूर", "मजुरी", "गडी" }, StringComparer.Ordinal));

    [Fact]
    public void Worker_tokens_start_at_one_for_each_transcript()
    {
        var d = NewDetector();

        var t1 = d.Detect("रामू मजूर आला. सीता मजुरी घेतली. गडी आला.",
            AutoRedactThreshold, DiscardThreshold);
        var t2 = d.Detect("रवि मजूर आला. सुनील मजुरी घेतली. गडी आला.",
            AutoRedactThreshold, DiscardThreshold);

        t1.Status.Should().Be(PiiDetectionStatus.AutoRedacted);
        t2.Status.Should().Be(PiiDetectionStatus.AutoRedacted);

        // Both transcripts independently start their token namespace at 1.
        t1.RedactedText.Should().Contain("[WORKER_1]");
        t1.RedactedText.Should().Contain("[WORKER_2]");
        t2.RedactedText.Should().Contain("[WORKER_1]");
        t2.RedactedText.Should().Contain("[WORKER_2]");

        // Cross-transcript: [WORKER_1] in t1 (रामू) is unrelated to
        // [WORKER_1] in t2 (रवि). No shared namespace. The detector
        // has no state across calls; the test is the proof.
    }

    [Fact]
    public void Redaction_assigns_tokens_in_first_encounter_order()
    {
        var d = NewDetector();
        var result = d.Detect(
            "सीता आली, मग रामू मजूर आला, मग गणेश आला. मजुरी झाली.",
            AutoRedactThreshold,
            DiscardThreshold);

        // 3 names + 2 markers → 0.4 * min(1, 2/3) + 0.6 * min(1, 3/2)
        //                     = 0.2667 + 0.6 = 0.8667 → AutoRedacted
        result.Status.Should().Be(PiiDetectionStatus.AutoRedacted);

        var idxOne = result.RedactedText!.IndexOf("[WORKER_1]", StringComparison.Ordinal);
        var idxTwo = result.RedactedText!.IndexOf("[WORKER_2]", StringComparison.Ordinal);
        var idxThree = result.RedactedText!.IndexOf("[WORKER_3]", StringComparison.Ordinal);

        idxOne.Should().BeGreaterThanOrEqualTo(0);
        idxTwo.Should().BeGreaterThan(idxOne);
        idxThree.Should().BeGreaterThan(idxTwo);
    }

    [Fact]
    public void Repeated_name_reuses_the_same_token()
    {
        var d = NewDetector();
        var result = d.Detect(
            "रामू मजूर आला. रामू मजुरी घेतली. रामू गडी झाला.",
            AutoRedactThreshold,
            DiscardThreshold);

        result.NameCount.Should().Be(1); // distinct names
        // The three "रामू" occurrences all become [WORKER_1]; no
        // [WORKER_2] should appear.
        result.RedactedText.Should().Contain("[WORKER_1]");
        result.RedactedText.Should().NotContain("[WORKER_2]");
        result.RedactedText.Should().NotContain("रामू");
    }
}
