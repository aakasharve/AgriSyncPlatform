using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Common;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B ledger-spine parent (ADR 0023 §1). A typed derived-operation row:
/// op identity + plot scope + day + parse-invariant <see cref="DerivedEventKey"/>
/// + supersession + inert district/dialect rail + owned <see cref="Provenance"/>.
/// Typed children (input items, irrigation, labour…) are owned by later tables.
/// </summary>
public sealed class FarmOperation : Entity<Guid>
{
    private FarmOperation() : base(Guid.Empty) { } // EF Core

    private FarmOperation(
        Guid id, FarmId farmId, Guid? plotId, string operationType, DateOnly operationDate,
        Guid? sourceDailyLogId, DerivedEventKey derivedEventKey, UserId createdByUserId,
        Provenance provenance, DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        OperationType = operationType;
        OperationDate = operationDate;
        SourceDailyLogId = sourceDailyLogId;
        DerivedEventKey = derivedEventKey;
        CreatedByUserId = createdByUserId;
        Provenance = provenance;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
        IsCurrentVersion = true;
    }

    public FarmId FarmId { get; private set; }
    public Guid? PlotId { get; private set; }
    public string OperationType { get; private set; } = string.Empty;
    public DateOnly OperationDate { get; private set; }
    public Guid? SourceDailyLogId { get; private set; }
    public DerivedEventKey DerivedEventKey { get; private set; }
    public bool IsCurrentVersion { get; private set; }
    public Guid? SupersededByOperationId { get; private set; }
    public string? DistrictCode { get; private set; }   // inert v1 (ADR §3 rail)
    public string? DialectRegion { get; private set; }  // inert v1
    public UserId CreatedByUserId { get; private set; }
    public Provenance Provenance { get; private set; } = null!;
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    public static FarmOperation Create(
        Guid id, FarmId farmId, Guid? plotId, string operationType, DateOnly operationDate,
        Guid? sourceDailyLogId, DerivedEventKey derivedEventKey, UserId createdByUserId,
        Provenance provenance, DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(operationType))
            throw new ArgumentException("operationType must be non-blank.", nameof(operationType));
        ArgumentNullException.ThrowIfNull(provenance);

        return new FarmOperation(
            id, farmId, plotId, operationType.Trim(), operationDate, sourceDailyLogId,
            derivedEventKey, createdByUserId, provenance, createdAtUtc);
    }

    /// <summary>Append-only supersession (ADR §1.2): the OLD row is marked
    /// non-current and points at its successor; the new row (same DerivedEventKey)
    /// is created via <see cref="Create"/> and stays current.</summary>
    public void MarkSuperseded(Guid newOperationId, DateTime occurredAtUtc)
    {
        if (!IsCurrentVersion)
            throw new InvalidOperationException("Operation is already superseded.");
        IsCurrentVersion = false;
        SupersededByOperationId = newOperationId;
        ModifiedAtUtc = occurredAtUtc;
    }
}
