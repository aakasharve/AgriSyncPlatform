using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Tests;

/// <summary>
/// A scheduled occurrence of a <see cref="TestProtocol"/> on a specific
/// crop cycle / plot / stage. See CEI §4.5.
/// <para>
/// State machine:
/// <list type="bullet">
/// <item><c>Due</c> → <c>Collected</c> via <see cref="MarkCollected"/>
///   (LabOperator | SecondaryOwner | Mukadam).</item>
/// <item><c>Collected</c> → <c>Reported</c> via <see cref="RecordResult"/>
///   (LabOperator; requires ≥1 attachment — CEI-I5).</item>
/// <item><c>Due</c> → <c>Overdue</c> via <see cref="MarkOverdue"/>
///   (background job, no human actor).</item>
/// <item><c>Due</c> → <c>Waived</c> via <see cref="Waive"/>
///   (PrimaryOwner | Agronomist; reason required).</item>
/// </list>
/// </para>
/// </summary>
public sealed class TestInstance : Entity<Guid>
{
    // CEI §4.5 — backed by List<Guid> (not HashSet) so EF Core's InMemory
    // provider doesn't try to compose a HashSet<->string converter on top of
    // the native uuid[] mapping. Uniqueness is enforced by the public API
    // via a Contains-before-Add check in RecordResult.
    private readonly List<Guid> _attachmentIds = [];
    private readonly List<TestResult> _results = [];

    private static readonly HashSet<AppRole> CollectorRoles =
    [
        AppRole.LabOperator,
        AppRole.SecondaryOwner,
        AppRole.Mukadam
    ];

    private static readonly HashSet<AppRole> ReporterRoles =
    [
        AppRole.LabOperator
    ];

    private static readonly HashSet<AppRole> WaiverRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.Agronomist
    ];

    private TestInstance() : base(Guid.Empty) { } // EF Core

    private TestInstance(
        Guid id,
        Guid testProtocolId,
        TestProtocolKind protocolKind,
        Guid cropCycleId,
        FarmId farmId,
        Guid plotId,
        string stageName,
        DateOnly plannedDueDate,
        DateTime createdAtUtc)
        : base(id)
    {
        TestProtocolId = testProtocolId;
        ProtocolKind = protocolKind;
        CropCycleId = cropCycleId;
        FarmId = farmId;
        PlotId = plotId;
        StageName = stageName;
        PlannedDueDate = plannedDueDate;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
        Status = TestInstanceStatus.Due;
    }

    public Guid TestProtocolId { get; private set; }

    /// <summary>
    /// Snapshot of the protocol's <see cref="TestProtocol.Kind"/> taken at
    /// scheduling time. Used by <c>TestRecommendationRuleBook</c> to match
    /// rules without a separate protocol lookup.
    /// </summary>
    public TestProtocolKind ProtocolKind { get; private set; }

    public Guid CropCycleId { get; private set; }
    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public string StageName { get; private set; } = string.Empty;
    public DateOnly PlannedDueDate { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>
    /// CEI Phase 2 §4.5 — updated on every state transition
    /// (MarkCollected, RecordResult, MarkOverdue, Waive). Used as the cursor
    /// column for the sync-pull envelope.
    /// </summary>
    public DateTime ModifiedAtUtc { get; private set; }

    public TestInstanceStatus Status { get; private set; } = TestInstanceStatus.Due;

    public UserId? CollectedByUserId { get; private set; }
    public DateTime? CollectedAtUtc { get; private set; }
    public UserId? ReportedByUserId { get; private set; }
    public DateTime? ReportedAtUtc { get; private set; }
    public string? WaivedReason { get; private set; }
    public UserId? WaivedByUserId { get; private set; }
    public DateTime? WaivedAtUtc { get; private set; }

    public IReadOnlyCollection<Guid> AttachmentIds => _attachmentIds;
    public IReadOnlyCollection<TestResult> Results => _results.AsReadOnly();

    public static TestInstance Schedule(
        Guid id,
        Guid testProtocolId,
        TestProtocolKind protocolKind,
        Guid cropCycleId,
        FarmId farmId,
        Guid plotId,
        string stageName,
        DateOnly plannedDueDate,
        DateTime createdAtUtc)
    {
        if (testProtocolId == Guid.Empty)
        {
            throw new ArgumentException("TestProtocolId is required.", nameof(testProtocolId));
        }
        if (cropCycleId == Guid.Empty)
        {
            throw new ArgumentException("CropCycleId is required.", nameof(cropCycleId));
        }
        if (farmId.IsEmpty)
        {
            throw new ArgumentException("FarmId is required.", nameof(farmId));
        }
        if (plotId == Guid.Empty)
        {
            throw new ArgumentException("PlotId is required.", nameof(plotId));
        }
        if (string.IsNullOrWhiteSpace(stageName))
        {
            throw new ArgumentException("Stage name is required.", nameof(stageName));
        }

        var instance = new TestInstance(
            id,
            testProtocolId,
            protocolKind,
            cropCycleId,
            farmId,
            plotId,
            stageName.Trim(),
            plannedDueDate,
            createdAtUtc);

        instance.Raise(new TestInstanceScheduledEvent(
            Guid.NewGuid(),
            createdAtUtc,
            id,
            testProtocolId,
            cropCycleId,
            farmId,
            plotId,
            instance.StageName,
            plannedDueDate));

        return instance;
    }

    public void MarkCollected(UserId collectorUserId, AppRole callerRole, DateTime occurredAtUtc)
    {
        if (Status != TestInstanceStatus.Due)
        {
            throw new InvalidOperationException(
                $"TestInstance {Id} must be in Due to be collected (was {Status}).");
        }

        if (!CollectorRoles.Contains(callerRole))
        {
            throw new InvalidOperationException(
                $"Role {callerRole} is not allowed to collect a test. " +
                $"Allowed: LabOperator, SecondaryOwner, Mukadam.");
        }

        Status = TestInstanceStatus.Collected;
        CollectedByUserId = collectorUserId;
        CollectedAtUtc = occurredAtUtc;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new TestInstanceCollectedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            collectorUserId));
    }

    public void RecordResult(
        UserId reporterUserId,
        AppRole callerRole,
        IReadOnlyCollection<TestResult> results,
        IReadOnlyCollection<Guid> attachmentIds,
        DateTime occurredAtUtc)
    {
        if (Status != TestInstanceStatus.Collected)
        {
            throw new InvalidOperationException(
                $"TestInstance {Id} must be Collected before results can be recorded (was {Status}).");
        }

        if (!ReporterRoles.Contains(callerRole))
        {
            throw new InvalidOperationException(
                $"Role {callerRole} is not allowed to report results. Allowed: LabOperator.");
        }

        if (results is null || results.Count == 0)
        {
            throw new ArgumentException(
                "At least one test result is required.", nameof(results));
        }

        // CEI-I5: a reported test MUST carry ≥1 finalised attachment (e.g. the lab report PDF).
        if (attachmentIds is null || attachmentIds.Count == 0)
        {
            throw new InvalidOperationException(
                "CEI-I5: recording a test result requires at least one finalised attachment.");
        }

        foreach (var attId in attachmentIds)
        {
            if (attId == Guid.Empty)
            {
                throw new ArgumentException(
                    "Attachment IDs must be non-empty.", nameof(attachmentIds));
            }

            if (!_attachmentIds.Contains(attId))
            {
                _attachmentIds.Add(attId);
            }
        }

        _results.AddRange(results);

        Status = TestInstanceStatus.Reported;
        ReportedByUserId = reporterUserId;
        ReportedAtUtc = occurredAtUtc;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new TestInstanceReportedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            reporterUserId,
            _results.Count,
            _attachmentIds.Count));
    }

    /// <summary>
    /// Background-job transition when <see cref="PlannedDueDate"/> has passed
    /// without collection. No human actor — role gate intentionally absent.
    /// </summary>
    public void MarkOverdue(DateTime occurredAtUtc)
    {
        if (Status != TestInstanceStatus.Due)
        {
            // Idempotent no-op for non-Due — protects against double-runs
            // of the overdue sweep job.
            return;
        }

        Status = TestInstanceStatus.Overdue;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new TestInstanceOverdueEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id));
    }

    public void Waive(UserId waiverUserId, AppRole callerRole, string reason, DateTime occurredAtUtc)
    {
        if (Status != TestInstanceStatus.Due && Status != TestInstanceStatus.Overdue)
        {
            throw new InvalidOperationException(
                $"TestInstance {Id} cannot be waived from state {Status}. " +
                $"Waive is only valid from Due or Overdue.");
        }

        if (!WaiverRoles.Contains(callerRole))
        {
            throw new InvalidOperationException(
                $"Role {callerRole} is not allowed to waive a test. " +
                $"Allowed: PrimaryOwner, Agronomist.");
        }

        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Waive reason is required.", nameof(reason));
        }

        Status = TestInstanceStatus.Waived;
        WaivedReason = reason.Trim();
        WaivedByUserId = waiverUserId;
        WaivedAtUtc = occurredAtUtc;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new TestInstanceWaivedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            waiverUserId,
            WaivedReason));
    }
}
