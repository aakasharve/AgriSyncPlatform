namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// Persisted domain event awaiting publish via the outbox dispatcher.
///
/// <para>
/// T-IGH-03-OUTBOX-PUBLISHER-IMPL: messages now carry an
/// <see cref="AttemptCount"/> incremented per failed publish, and a
/// <see cref="DeadLetteredAt"/> timestamp set when the dispatcher's
/// retry budget is exhausted. Dead-lettered rows are skipped by
/// subsequent dispatch cycles; an alert (logged at <c>LogLevel.Error</c>
/// by the dispatcher when the DLQ transition happens) tells ops a row
/// needs human triage.
/// </para>
/// </summary>
public sealed class OutboxMessage
{
    private OutboxMessage()
    {
    }

    public OutboxMessage(Guid id, string type, string payload, DateTime occurredOnUtc)
    {
        Id = id;
        Type = type;
        Payload = payload;
        OccurredOnUtc = occurredOnUtc;
    }

    public Guid Id { get; private set; }

    public string Type { get; private set; } = string.Empty;

    public string Payload { get; private set; } = string.Empty;

    public DateTime OccurredOnUtc { get; private set; }

    public DateTime? ProcessedOnUtc { get; private set; }

    public string? Error { get; private set; }

    /// <summary>
    /// Number of times the dispatcher has attempted to publish this
    /// message. Incremented by <see cref="MarkAttemptFailed"/> on each
    /// publish failure. A successful publish does NOT reset this — the
    /// row is marked processed instead.
    /// </summary>
    public int AttemptCount { get; private set; }

    /// <summary>
    /// Timestamp when this row was moved to the dead-letter queue. Set
    /// by <see cref="MarkDeadLettered"/> once
    /// <see cref="AttemptCount"/> reaches the dispatcher's configured
    /// retry budget. Once set, the dispatcher skips this row on every
    /// future cycle. Manual ops resolution is required (re-publish via
    /// a runbook, or accept the loss).
    /// </summary>
    public DateTime? DeadLetteredAt { get; private set; }

    public void MarkProcessed(DateTime processedOnUtc)
    {
        ProcessedOnUtc = processedOnUtc;
        Error = null;
    }

    /// <summary>
    /// Records a publish-attempt failure: increments
    /// <see cref="AttemptCount"/> and stores the error message.
    /// Caller (the dispatcher) checks the new count against the
    /// configured budget and calls
    /// <see cref="MarkDeadLettered"/> when the budget is exhausted.
    /// </summary>
    public void MarkAttemptFailed(string error)
    {
        AttemptCount += 1;
        Error = error;
    }

    /// <summary>
    /// Pre-T-IGH-03-OUTBOX-PUBLISHER-IMPL alias kept for backward
    /// compatibility with any external caller that still invokes the
    /// older API. New code should prefer
    /// <see cref="MarkAttemptFailed"/> so the retry-budget semantics
    /// are explicit at the call site.
    /// </summary>
    public void MarkFailed(string error) => MarkAttemptFailed(error);

    /// <summary>
    /// Moves this row to the dead-letter queue. Dispatcher cycles will
    /// skip rows with <see cref="DeadLetteredAt"/> set; ops triage is
    /// required to re-publish or accept the loss.
    /// </summary>
    public void MarkDeadLettered(DateTime deadLetteredAtUtc)
    {
        DeadLetteredAt = deadLetteredAtUtc;
    }
}
