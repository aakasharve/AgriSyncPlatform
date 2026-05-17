// spec: data-principle-spine-2026-05-05/10.2
using System.Text.Json;

namespace ShramSafal.Domain.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.2 — append-only PII review
/// queue row backing <c>ssf.pii_review_queue</c>.
///
/// <para>
/// <b>Lifecycle.</b> Created on every detection event that needs an
/// audit trail (auto-redacted or pending human review). Reviewers
/// transition <see cref="Status"/> through <see cref="Approve"/> or
/// <see cref="Reject"/>; the row is never deleted (migration REVOKEs
/// DELETE on the table). When the detector decides
/// <see cref="PiiDetectionStatus.Discard"/> the transcript is dropped
/// and a row is written here with <see cref="PiiReviewStatus.Discarded"/>
/// so the discard decision still has a recorded trail.
/// </para>
///
/// <para>
/// <b>RLS exemption.</b> This table is admin-only; reviewers span all
/// farms (per OQ-6). It is added to
/// <c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c> in this
/// envelope with the justification "admin-only surface; no farm RLS
/// (reviewers span all farms)".
/// </para>
/// </summary>
public sealed class PiiReviewQueueEntry
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public Guid Id { get; private set; }
    public Guid TranscriptId { get; private set; }

    /// <summary>
    /// Raw transcript snapshot at scan time. Auto-redacted /
    /// review-pending rows store the original here for diff display in
    /// the admin UI. Discarded rows still store the original so a
    /// reviewer can manually confirm the discard if needed.
    /// </summary>
    public string OriginalText { get; private set; } = string.Empty;

    /// <summary>Redacted form (positional [WORKER_N] tokens) or empty for discard rows.</summary>
    public string RedactedText { get; private set; } = string.Empty;

    /// <summary>
    /// JSON serialisation of the <see cref="PiiDetection"/> outcome at
    /// scan time. Stored as <c>jsonb</c> (see EF configuration) so the
    /// admin UI can render score / marker count / name count without
    /// re-parsing in C#.
    /// </summary>
    public string DetectionJson { get; private set; } = "{}";

    public PiiReviewStatus Status { get; private set; }
    public Guid? ReviewedByUserId { get; private set; }
    public string? ReviewNote { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
    public DateTime? ReviewedAtUtc { get; private set; }

    private PiiReviewQueueEntry()
    {
        // EF Core materialisation only.
    }

    /// <summary>
    /// Factory for a brand-new queue row. Status is derived from the
    /// detection: <see cref="PiiDetectionStatus.AutoRedacted"/> /
    /// <see cref="PiiDetectionStatus.ReviewQueue"/> /
    /// <see cref="PiiDetectionStatus.Discard"/> map to
    /// <see cref="PiiReviewStatus.AutoRedacted"/> /
    /// <see cref="PiiReviewStatus.Pending"/> /
    /// <see cref="PiiReviewStatus.Discarded"/> respectively. Clean
    /// detections do NOT write a row.
    /// </summary>
    public static PiiReviewQueueEntry FromDetection(
        Guid transcriptId,
        string originalText,
        PiiDetection detection,
        DateTime nowUtc)
    {
        if (transcriptId == Guid.Empty)
        {
            throw new ArgumentException("transcriptId required", nameof(transcriptId));
        }

        ArgumentNullException.ThrowIfNull(detection);

        var status = detection.Status switch
        {
            PiiDetectionStatus.AutoRedacted => PiiReviewStatus.AutoRedacted,
            PiiDetectionStatus.ReviewQueue => PiiReviewStatus.Pending,
            PiiDetectionStatus.Discard => PiiReviewStatus.Discarded,
            PiiDetectionStatus.Clean => throw new InvalidOperationException(
                "Clean detections do not produce review queue rows."),
            _ => throw new ArgumentOutOfRangeException(
                nameof(detection), detection.Status, "Unknown PiiDetectionStatus"),
        };

        return new PiiReviewQueueEntry
        {
            Id = Guid.NewGuid(),
            TranscriptId = transcriptId,
            OriginalText = originalText ?? string.Empty,
            RedactedText = detection.RedactedText ?? string.Empty,
            DetectionJson = JsonSerializer.Serialize(SnapshotOf(detection), SerializerOptions),
            Status = status,
            ReviewedByUserId = null,
            ReviewNote = null,
            OccurredAtUtc = nowUtc,
            ReviewedAtUtc = null,
        };
    }

    /// <summary>Reviewer accepted the redaction — corpus may proceed (Phase 09 reader).</summary>
    public void Approve(Guid reviewerUserId, string? note, DateTime nowUtc)
    {
        if (Status != PiiReviewStatus.Pending)
        {
            throw new InvalidOperationException(
                $"Cannot approve a queue row in status {Status}.");
        }

        if (reviewerUserId == Guid.Empty)
        {
            throw new ArgumentException("reviewerUserId required", nameof(reviewerUserId));
        }

        Status = PiiReviewStatus.ReviewApproved;
        ReviewedByUserId = reviewerUserId;
        ReviewNote = note;
        ReviewedAtUtc = nowUtc;
    }

    /// <summary>
    /// Reviewer rejected the redaction. Per envelope §10.4, the
    /// transcript persists as-is (i.e. the detector's redaction is
    /// reverted by the calling write-path; this row only records the
    /// decision). Corpus inclusion downstream remains gated separately.
    /// </summary>
    public void Reject(Guid reviewerUserId, string? note, DateTime nowUtc)
    {
        if (Status != PiiReviewStatus.Pending)
        {
            throw new InvalidOperationException(
                $"Cannot reject a queue row in status {Status}.");
        }

        if (reviewerUserId == Guid.Empty)
        {
            throw new ArgumentException("reviewerUserId required", nameof(reviewerUserId));
        }

        Status = PiiReviewStatus.ReviewRejected;
        ReviewedByUserId = reviewerUserId;
        ReviewNote = note;
        ReviewedAtUtc = nowUtc;
    }

    private static object SnapshotOf(PiiDetection d) => new
    {
        score = d.Score,
        matchedNameCount = d.MatchedNames.Count,
        markerCount = d.MarkerCount,
        nameCount = d.NameCount,
        status = d.Status.ToString(),
    };
}

/// <summary>
/// Lifecycle status of a <see cref="PiiReviewQueueEntry"/>. Persisted
/// as a string column for human-readable diagnostics.
/// </summary>
public enum PiiReviewStatus
{
    /// <summary>Detector score in the review band; awaiting reviewer decision.</summary>
    Pending = 0,

    /// <summary>Detector score above the auto-redact threshold; the row is an audit trail.</summary>
    AutoRedacted = 1,

    /// <summary>Reviewer accepted the redaction.</summary>
    ReviewApproved = 2,

    /// <summary>Reviewer rejected the redaction (transcript persists as-is).</summary>
    ReviewRejected = 3,

    /// <summary>Detector score in the discard band; transcript dropped without persistence.</summary>
    Discarded = 4,
}
