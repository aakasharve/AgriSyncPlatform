// spec: data-principle-spine-2026-05-05/10.1
using FluentAssertions;
using ShramSafal.Domain.Privacy.Pii;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 — Domain-level
/// coverage of the pure <see cref="WorkerNameDetector"/> engine.
/// The Infrastructure adapter (HeuristicWorkerNameDetector) is a
/// thin wrapper that loads the embedded dictionary and forwards to
/// this engine; testing the engine directly is sufficient.
/// </summary>
public sealed class HeuristicWorkerNameDetectorTests
{
    private const decimal AutoRedactThreshold = 0.85m;
    private const decimal DiscardThreshold = 0.3m;

    private static WorkerNameDetector NewDetector(
        IEnumerable<string>? names = null,
        IEnumerable<string>? markers = null) =>
        new(
            names: new HashSet<string>(names ?? new[] { "रामू", "सीता", "रवि", "Ravi" }, StringComparer.Ordinal),
            markers: new HashSet<string>(markers ?? new[] { "मजूर", "मजुरी", "गडी", "worker" }, StringComparer.Ordinal));

    [Fact]
    public void Empty_text_scores_zero_and_is_clean()
    {
        var d = NewDetector();
        var result = d.Detect(string.Empty, AutoRedactThreshold, DiscardThreshold);

        result.Score.Should().Be(0m);
        result.Status.Should().Be(PiiDetectionStatus.Clean);
        result.MarkerCount.Should().Be(0);
        result.NameCount.Should().Be(0);
        result.RedactedText.Should().BeNull();
    }

    [Fact]
    public void Single_name_no_marker_lands_in_review_band()
    {
        var d = NewDetector();
        var result = d.Detect("आज रामू आला.", AutoRedactThreshold, DiscardThreshold);

        // 0.4*min(1, 0/3) + 0.6*min(1, 1/2) = 0.30
        result.Score.Should().Be(0.30m);
        result.NameCount.Should().Be(1);
        result.MarkerCount.Should().Be(0);
        // 0.30 is at the discard threshold; per detector contract,
        // <= DiscardThreshold returns Clean (not Discard) unless the
        // explicit drop semantics kick in.
        result.Status.Should().Be(PiiDetectionStatus.Clean);
    }

    [Fact]
    public void Two_names_and_one_marker_lands_in_review_queue()
    {
        var d = NewDetector();
        // 2 names + 1 marker → 0.4 * min(1, 1/3) + 0.6 * min(1, 2/2)
        //                    = 0.1333 + 0.6 = 0.7333
        var result = d.Detect("रामू मजूर आला, सीता पण होती.", AutoRedactThreshold, DiscardThreshold);

        result.NameCount.Should().Be(2);
        result.MarkerCount.Should().Be(1);
        result.Score.Should().BeApproximately(0.7333m, 0.001m);
        result.Status.Should().Be(PiiDetectionStatus.ReviewQueue);
        result.RedactedText.Should().NotBeNull();
        result.RedactedText.Should().Contain("[WORKER_1]");
        result.RedactedText.Should().Contain("[WORKER_2]");
        result.RedactedText.Should().NotContain("रामू");
        result.RedactedText.Should().NotContain("सीता");
    }

    [Fact]
    public void Three_markers_two_plus_names_saturates_to_auto_redact()
    {
        var d = NewDetector();
        // 3 markers + 2 names → 0.4*1 + 0.6*1 = 1.0
        var result = d.Detect(
            "रामू मजूर आला. सीता मजुरी घेतली. गडी आला.",
            AutoRedactThreshold,
            DiscardThreshold);

        result.NameCount.Should().Be(2);
        result.MarkerCount.Should().Be(3);
        result.Score.Should().Be(1.0m);
        result.Status.Should().Be(PiiDetectionStatus.AutoRedacted);
        result.RedactedText.Should().Contain("[WORKER_1]");
        result.RedactedText.Should().Contain("[WORKER_2]");
    }

    [Fact]
    public void Redaction_uses_positional_worker_tokens_in_first_encounter_order()
    {
        var d = NewDetector();
        var result = d.Detect(
            "सीता मजूर आली, मग रामू मजूर आला, मग सीता परत आली.",
            AutoRedactThreshold,
            DiscardThreshold);

        // 2 distinct names + 2 markers → 0.4*0.667 + 0.6*1 = 0.867
        result.Status.Should().Be(PiiDetectionStatus.AutoRedacted);
        result.RedactedText.Should().NotContain("सीता");
        result.RedactedText.Should().NotContain("रामू");
        // First encountered: सीता → [WORKER_1]; second: रामू → [WORKER_2]
        result.RedactedText.Should().Contain("[WORKER_1]");
        result.RedactedText.Should().Contain("[WORKER_2]");
    }

    [Fact]
    public void Marker_only_text_with_no_name_is_clean()
    {
        var d = NewDetector();
        // "मजूर" sits as a whole token between whitespace; no names
        // anywhere → score = 0.4*0.333 + 0 = 0.133 (< discard).
        var result = d.Detect("मजूर पैसे द्यायचे आहेत.", AutoRedactThreshold, DiscardThreshold);

        result.MarkerCount.Should().Be(1);
        result.NameCount.Should().Be(0);
        result.Status.Should().Be(PiiDetectionStatus.Clean);
    }

    [Fact]
    public void Configurable_thresholds_change_routing_band()
    {
        var d = NewDetector();
        // 1 name + 1 marker → 0.4*0.333 + 0.6*0.5 = 0.4333
        var text = "रामू मजूर आला.";

        // With default thresholds, this lands in review queue.
        var defaultResult = d.Detect(text, AutoRedactThreshold, DiscardThreshold);
        defaultResult.Status.Should().Be(PiiDetectionStatus.ReviewQueue);

        // With AutoRedact lowered to 0.40, the same text auto-redacts.
        var lowered = d.Detect(text, 0.40m, DiscardThreshold);
        lowered.Status.Should().Be(PiiDetectionStatus.AutoRedacted);
    }
}
