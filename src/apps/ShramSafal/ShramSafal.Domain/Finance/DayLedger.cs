using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Finance;

public sealed class DayLedger : Entity<Guid>
{
    private readonly List<DayLedgerAllocation> _allocations = [];

    private DayLedger() : base(Guid.Empty) { } // EF Core

    private DayLedger(
        Guid id,
        FarmId farmId,
        Guid sourceCostEntryId,
        DateOnly ledgerDate,
        string allocationBasis,
        UserId createdByUserId,
        DateTime createdAtUtc,
        IEnumerable<DayLedgerAllocation> allocations)
        : base(id)
    {
        FarmId = farmId;
        SourceCostEntryId = sourceCostEntryId;
        LedgerDate = ledgerDate;
        AllocationBasis = allocationBasis;
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
        _allocations.AddRange(allocations);
    }

    public FarmId FarmId { get; private set; }
    public Guid SourceCostEntryId { get; private set; }
    public DateOnly LedgerDate { get; private set; }
    public string AllocationBasis { get; private set; } = string.Empty;
    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public IReadOnlyCollection<DayLedgerAllocation> Allocations => _allocations.AsReadOnly();

    public static DayLedger Create(
        Guid id,
        FarmId farmId,
        Guid sourceCostEntryId,
        DateOnly ledgerDate,
        string allocationBasis,
        UserId createdByUserId,
        IReadOnlyCollection<DayLedgerAllocation> allocations,
        DateTime createdAtUtc)
    {
        if (sourceCostEntryId == Guid.Empty)
        {
            throw new ArgumentException("Source cost entry id is required.", nameof(sourceCostEntryId));
        }

        if (string.IsNullOrWhiteSpace(allocationBasis))
        {
            throw new ArgumentException("Allocation basis is required.", nameof(allocationBasis));
        }

        if (allocations.Count == 0)
        {
            throw new ArgumentException("At least one allocation is required.", nameof(allocations));
        }

        var normalizedAllocations = allocations
            .Where(x => x.AllocatedAmount > 0)
            .ToList();

        if (normalizedAllocations.Count != allocations.Count)
        {
            throw new ArgumentException("Allocation amount must be greater than zero.", nameof(allocations));
        }

        return new DayLedger(
            id,
            farmId,
            sourceCostEntryId,
            ledgerDate,
            allocationBasis.Trim(),
            createdByUserId,
            createdAtUtc,
            normalizedAllocations);
    }
}
