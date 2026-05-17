// spec: data-principle-spine-2026-05-05/10.1
namespace ShramSafal.Domain.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 — append-only domain
/// event captured every time the heuristic detector replaces one or
/// more worker-name tokens with positional <c>[WORKER_N]</c> markers.
/// Used by future analytics (Phase 11 retraining excludes these per
/// OQ-9 verdict — see <c>CorrectionType</c> extension in the same
/// envelope).
///
/// <para>
/// <b>Not persisted as an aggregate root.</b> Currently a thin record;
/// the Phase 09 corpus reader/analytics pipeline projects this onto
/// the <c>analyticsOutbox</c> via <c>AuditEventFactory</c> instead of
/// owning its own table. Carrying the type in the domain (rather than
/// inlining an anonymous payload) keeps the contract greppable when
/// Phase 11 lands.
/// </para>
/// </summary>
public sealed record PiiRedactionEvent(
    Guid TranscriptId,
    int RedactedTokenCount,
    decimal Score,
    DateTime OccurredAtUtc);
