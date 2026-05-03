namespace ShramSafal.Domain.Wtl;

/// <summary>
/// Work Trust Ledger v0 link entity tying a <see cref="Worker"/> to the
/// <c>DailyLog</c> in which their name was extracted.
/// </summary>
/// <remarks>
/// <para>
/// ADR <c>2026-05-04 wtl-v0-entity-shape</c>. Append-only — the projector
/// inserts one row per name extracted from each new transcript. There is
/// no farmer-facing edit or delete path in v0.
/// </para>
/// <para>
/// <see cref="Confidence"/> is the extractor's per-match confidence in the
/// 0..1 range. The current <c>RegexWorkerNameExtractor</c> reports a flat
/// confidence per pattern; future ML-backed extractors can vary it.
/// </para>
/// </remarks>
public sealed class WorkerAssignment
{
    public Guid Id { get; private set; }
    public Guid WorkerId { get; private set; }
    public Guid DailyLogId { get; private set; }
    public decimal Confidence { get; private set; }
    public DateTimeOffset OccurredAtUtc { get; private set; }

    private WorkerAssignment() { }

    public WorkerAssignment(Guid workerId, Guid dailyLogId, decimal confidence, DateTimeOffset occurredAt)
    {
        if (confidence < 0m || confidence > 1m)
        {
            throw new ArgumentOutOfRangeException(nameof(confidence), confidence,
                "WorkerAssignment.Confidence must be in the inclusive range [0, 1].");
        }

        Id = Guid.NewGuid();
        WorkerId = workerId;
        DailyLogId = dailyLogId;
        Confidence = confidence;
        OccurredAtUtc = occurredAt;
    }
}
