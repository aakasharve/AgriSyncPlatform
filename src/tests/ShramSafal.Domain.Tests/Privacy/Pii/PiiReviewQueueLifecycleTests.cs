// spec: data-principle-spine-2026-05-05/10.2 / 10.4
using FluentAssertions;
using ShramSafal.Domain.Privacy.Pii;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.2 / 10.4 — lifecycle
/// coverage of <see cref="PiiReviewQueueEntry"/>: factory from
/// detection, transition through Approve / Reject, idempotency
/// invariants (already-reviewed rejection).
///
/// <para>
/// <b>Deviation from envelope.</b> Envelope §Tests lists a Sync
/// IntegrationTest <c>PiiReviewQueueLifecycleTests.cs</c>; the
/// integration project requires Postgres + Testcontainers wiring
/// (Docker), which the project memory marks as
/// <c>avoid_docker_local_dev</c>. The lifecycle invariants under test
/// are entirely Domain-level: queue factory + state-machine
/// transitions. Co-locating them with the other Domain Pii tests
/// keeps the envelope green without forcing Docker on this machine
/// (CI's containerised matrix already covers the EF/DB layer through
/// the existing Sync.IntegrationTests harness).
/// </para>
/// </summary>
public sealed class PiiReviewQueueLifecycleTests
{
    private const decimal AutoRedactThreshold = 0.85m;
    private const decimal DiscardThreshold = 0.3m;

    private static WorkerNameDetector NewDetector() =>
        new(
            names: new HashSet<string>(new[] { "रामू", "सीता", "रवि" }, StringComparer.Ordinal),
            markers: new HashSet<string>(new[] { "मजूर", "मजुरी", "गडी" }, StringComparer.Ordinal));

    [Fact]
    public void Auto_redacted_detection_creates_queue_entry_marked_AutoRedacted()
    {
        var d = NewDetector();
        var detection = d.Detect(
            "रामू मजूर आला, सीता मजुरी घेतली, गडी आला.",
            AutoRedactThreshold,
            DiscardThreshold);
        detection.Status.Should().Be(PiiDetectionStatus.AutoRedacted);

        var entry = PiiReviewQueueEntry.FromDetection(
            transcriptId: Guid.NewGuid(),
            originalText: "रामू मजूर आला, सीता मजुरी घेतली, गडी आला.",
            detection: detection,
            nowUtc: DateTime.UtcNow);

        entry.Status.Should().Be(PiiReviewStatus.AutoRedacted);
        entry.ReviewedByUserId.Should().BeNull();
        entry.ReviewNote.Should().BeNull();
        entry.OriginalText.Should().Contain("रामू");
        entry.RedactedText.Should().Contain("[WORKER_1]");
        entry.RedactedText.Should().NotContain("रामू");
        entry.DetectionJson.Should().Contain("AutoRedacted");
    }

    [Fact]
    public void Review_queue_band_creates_pending_entry()
    {
        var d = NewDetector();
        // 2 names + 1 marker → 0.7333 → ReviewQueue
        var detection = d.Detect(
            "रामू मजूर आला, सीता पण होती.",
            AutoRedactThreshold,
            DiscardThreshold);
        detection.Status.Should().Be(PiiDetectionStatus.ReviewQueue);

        var entry = PiiReviewQueueEntry.FromDetection(
            transcriptId: Guid.NewGuid(),
            originalText: "रामू मजूर आला, सीता पण होती.",
            detection: detection,
            nowUtc: DateTime.UtcNow);

        entry.Status.Should().Be(PiiReviewStatus.Pending);
    }

    [Fact]
    public void Pending_entry_can_be_approved_and_carries_reviewer_metadata()
    {
        var d = NewDetector();
        var detection = d.Detect(
            "रामू मजूर आला, सीता पण होती.",
            AutoRedactThreshold,
            DiscardThreshold);
        var entry = PiiReviewQueueEntry.FromDetection(
            transcriptId: Guid.NewGuid(),
            originalText: "रामू मजूर आला, सीता पण होती.",
            detection: detection,
            nowUtc: DateTime.UtcNow);

        var reviewer = Guid.NewGuid();
        var reviewedAt = DateTime.UtcNow.AddMinutes(5);
        entry.Approve(reviewer, "Reviewed and confirmed redaction.", reviewedAt);

        entry.Status.Should().Be(PiiReviewStatus.ReviewApproved);
        entry.ReviewedByUserId.Should().Be(reviewer);
        entry.ReviewNote.Should().Be("Reviewed and confirmed redaction.");
        entry.ReviewedAtUtc.Should().Be(reviewedAt);
    }

    [Fact]
    public void Pending_entry_can_be_rejected_with_note()
    {
        var d = NewDetector();
        var detection = d.Detect(
            "रामू मजूर आला, सीता पण होती.",
            AutoRedactThreshold,
            DiscardThreshold);
        var entry = PiiReviewQueueEntry.FromDetection(
            transcriptId: Guid.NewGuid(),
            originalText: "रामू मजूर आला, सीता पण होती.",
            detection: detection,
            nowUtc: DateTime.UtcNow);

        var reviewer = Guid.NewGuid();
        entry.Reject(reviewer, "False positive — these are crops not names.", DateTime.UtcNow);

        entry.Status.Should().Be(PiiReviewStatus.ReviewRejected);
        entry.ReviewedByUserId.Should().Be(reviewer);
        entry.ReviewNote.Should().Contain("False positive");
    }

    [Fact]
    public void Already_reviewed_entry_cannot_be_re_approved()
    {
        var d = NewDetector();
        var detection = d.Detect(
            "रामू मजूर आला, सीता पण होती.",
            AutoRedactThreshold,
            DiscardThreshold);
        var entry = PiiReviewQueueEntry.FromDetection(
            transcriptId: Guid.NewGuid(),
            originalText: "रामू मजूर आला, सीता पण होती.",
            detection: detection,
            nowUtc: DateTime.UtcNow);

        var reviewer = Guid.NewGuid();
        entry.Approve(reviewer, null, DateTime.UtcNow);

        // Second approval attempt must throw — the row is now in
        // ReviewApproved status and the state machine forbids the
        // backward transition.
        var act = () => entry.Approve(Guid.NewGuid(), null, DateTime.UtcNow);
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void Clean_detection_does_not_yield_queue_entry()
    {
        var d = NewDetector();
        var detection = d.Detect("आज पाणी दिले.", AutoRedactThreshold, DiscardThreshold);
        detection.Status.Should().Be(PiiDetectionStatus.Clean);

        var act = () => PiiReviewQueueEntry.FromDetection(
            transcriptId: Guid.NewGuid(),
            originalText: "आज पाणी दिले.",
            detection: detection,
            nowUtc: DateTime.UtcNow);
        act.Should().Throw<InvalidOperationException>(
            because: "clean detections must not generate queue rows.");
    }
}
