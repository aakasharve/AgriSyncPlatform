// spec: data-principle-spine-2026-05-05/10.1
namespace ShramSafal.Domain.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 — outcome of a heuristic
/// third-party-PII scan over a single transcript text. Returned by
/// <c>IThirdPartyPiiDetector.DetectAsync</c> and consumed by both
/// <c>ParseVoiceInputHandler</c> (write-path) and the
/// <see cref="PiiReviewQueueEntry"/> writer.
///
/// <para>
/// <b>Scoring (OQ-3 verdict).</b> The detector implementation computes
/// <see cref="Score"/> via the formula
/// <c>0.4·min(1, markerCount/3) + 0.6·min(1, nameCount/2)</c>. Bands
/// (<see cref="Status"/>) are derived from configurable thresholds bound
/// in <c>PiiOptions</c> — defaults: <c>AutoRedactThreshold = 0.85</c>,
/// <c>DiscardThreshold = 0.3</c>.
/// </para>
///
/// <para>
/// <b>Sealed value object.</b> Constructed only by the detector. The
/// shape is intentionally flat — no nested aggregates — because every
/// consumer treats this as an immutable scan result, not a behaviour
/// hub.
/// </para>
/// </summary>
public sealed class PiiDetection
{
    /// <summary>0.0..1.0 confidence that the text contains worker/mukadam PII.</summary>
    public decimal Score { get; }

    /// <summary>Distinct dictionary-matched name tokens in the source order discovered.</summary>
    public IReadOnlyList<string> MatchedNames { get; }

    /// <summary>Total marker-token hits (मजूर, गडी, worker, ...).</summary>
    public int MarkerCount { get; }

    /// <summary>Distinct name-token hits (cardinality of <see cref="MatchedNames"/>).</summary>
    public int NameCount { get; }

    /// <summary>Routing band — derived from <see cref="Score"/> against the configured thresholds.</summary>
    public PiiDetectionStatus Status { get; }

    /// <summary>
    /// The redacted text the detector produced for write-back, or
    /// <c>null</c> when the source was <see cref="PiiDetectionStatus.Clean"/>
    /// (no replacement needed) or <see cref="PiiDetectionStatus.Discard"/>
    /// (transcript is dropped entirely).
    /// </summary>
    public string? RedactedText { get; }

    public PiiDetection(
        decimal score,
        IReadOnlyList<string> matchedNames,
        int markerCount,
        int nameCount,
        PiiDetectionStatus status,
        string? redactedText)
    {
        if (score < 0m || score > 1m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(score), score, "score must be in [0,1]");
        }

        Score = score;
        MatchedNames = matchedNames ?? Array.Empty<string>();
        MarkerCount = markerCount;
        NameCount = nameCount;
        Status = status;
        RedactedText = redactedText;
    }

    /// <summary>Convenience builder for a clean scan (no PII signal).</summary>
    public static PiiDetection Clean() =>
        new(
            score: 0m,
            matchedNames: Array.Empty<string>(),
            markerCount: 0,
            nameCount: 0,
            status: PiiDetectionStatus.Clean,
            redactedText: null);
}

/// <summary>
/// Routing band emitted by the detector. <see cref="ParseVoiceInputHandler"/>
/// branches on this enum (per OQ-5 verdict — synchronous wire).
/// </summary>
public enum PiiDetectionStatus
{
    /// <summary>Score below the discard threshold (default 0.3) — persist transcript verbatim.</summary>
    Clean = 0,

    /// <summary>Score in (DiscardThreshold, AutoRedactThreshold) — persist redacted + enqueue for review.</summary>
    ReviewQueue = 1,

    /// <summary>Score &gt;= AutoRedactThreshold — persist redacted + write an audit-trail review-queue row.</summary>
    AutoRedacted = 2,

    /// <summary>
    /// Score &lt;= DiscardThreshold but the text contains BOTH a marker
    /// AND a name with low overall signal — the discard band is reserved
    /// for the explicit drop path (no transcript persisted). Defaults
    /// route most low-score traffic through <see cref="Clean"/>; the
    /// drop path activates only when the formula explicitly says so.
    /// </summary>
    Discard = 3,
}
