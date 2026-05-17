// spec: data-principle-spine-2026-05-05/10.1
using ShramSafal.Domain.Privacy.Pii;

namespace ShramSafal.Application.Ports.Privacy;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 — port for the
/// third-party PII detector. V1 is a heuristic implementation
/// (<c>HeuristicWorkerNameDetector</c>) per OQ-2 verdict; a future v2
/// may swap in a fine-tuned NER model. The contract stays.
///
/// <para>
/// <b>No Gemini calls.</b> Per OQ-2 the heuristic floor avoids
/// inflating <c>cross_border_transfers</c> volume — every Gemini call
/// writes a row to that table (Phase 05). An architecture test in
/// this envelope asserts the detector never triggers a cross-border
/// transfer.
/// </para>
/// </summary>
public interface IThirdPartyPiiDetector
{
    /// <summary>
    /// Scan <paramref name="text"/> for worker/mukadam PII signals
    /// and return the detection result. <paramref name="transcriptId"/>
    /// is threaded through for observability (logging / outbox
    /// correlation) but the detector itself does not persist anything.
    /// </summary>
    Task<PiiDetection> DetectAsync(Guid transcriptId, string text, CancellationToken ct);

    /// <summary>
    /// Convenience guard for read-paths that only need a boolean
    /// "is this transcript free of third-party PII" answer. V1
    /// implementation re-runs the heuristic; callers MUST treat
    /// <c>true</c> as "no detected PII at this score band" not as a
    /// formal certification. Future v2 may consult a persisted
    /// flag table (see Phase 09 reader contract).
    /// </summary>
    Task<bool> IsClean(Guid transcriptId, CancellationToken ct);
}
