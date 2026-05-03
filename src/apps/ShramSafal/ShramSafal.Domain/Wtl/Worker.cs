using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Wtl;

/// <summary>
/// Work Trust Ledger v0 — a passively-captured worker record extracted
/// from <c>DailyLog</c> transcripts. NEVER farmer-facing in v0.
/// </summary>
/// <remarks>
/// <para>
/// Decision: ADR <c>2026-05-04 wtl-v0-entity-shape</c>. Population is by
/// the <see cref="WorkerNameProjector"/> (DWC plan §2.10) which subscribes
/// to <c>LogCreatedEvent</c> and runs the regex extractor over the
/// transcript. There is no API path that creates a <see cref="Worker"/>
/// directly.
/// </para>
/// <para>
/// <see cref="AssignmentCount"/> is denormalized for read performance —
/// the Mode A admin drilldown lists top 5 workers by assignment count
/// per farm. The trade-off (two-table write per assignment) is justified
/// in the ADR §Consequences.
/// </para>
/// </remarks>
public sealed class Worker
{
    public Guid Id { get; private set; }
    public FarmId FarmId { get; private set; }
    public WorkerName Name { get; private set; } = default!;
    public DateTimeOffset FirstSeenUtc { get; private set; }
    public int AssignmentCount { get; private set; }

    private Worker() { }

    public Worker(FarmId farmId, WorkerName name, DateTimeOffset firstSeen)
    {
        ArgumentNullException.ThrowIfNull(name);

        Id = Guid.NewGuid();
        FarmId = farmId;
        Name = name;
        FirstSeenUtc = firstSeen;
        AssignmentCount = 0;
    }

    /// <summary>
    /// Increments the denormalized assignment counter. Called by the
    /// projector immediately after inserting a <see cref="WorkerAssignment"/>
    /// in the same SaveChanges call.
    /// </summary>
    public void RegisterAssignment() => AssignmentCount += 1;
}
