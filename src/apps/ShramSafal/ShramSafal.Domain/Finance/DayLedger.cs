using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Finance;

public sealed class DayLedger : Entity<Guid>
{
    private DayLedger() : base(Guid.Empty) { } // EF Core

    private DayLedger(
        Guid id,
        FarmId farmId,
        DateOnly dateKey,
        AllocationStrategy allocationStrategy,
        DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        DateKey = dateKey;
        AllocationStrategy = allocationStrategy;
        CreatedAtUtc = createdAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public DateOnly DateKey { get; private set; }
    public List<Guid> GlobalExpenseIds { get; private set; } = [];
    public AllocationStrategy AllocationStrategy { get; private set; }
    public decimal TotalGlobalCost { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public List<PlotAllocation> PlotAllocations { get; private set; } = [];

    public static DayLedger Create(
        Guid id,
        FarmId farmId,
        DateOnly dateKey,
        AllocationStrategy strategy,
        DateTime createdAtUtc)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Ledger id is required.", nameof(id));
        }

        return new DayLedger(id, farmId, dateKey, strategy, createdAtUtc);
    }

    public void ReplaceAllocations(
        IReadOnlyCollection<Guid> globalExpenseIds,
        IReadOnlyCollection<PlotAllocation> allocations,
        decimal totalGlobalCost)
    {
        ArgumentNullException.ThrowIfNull(globalExpenseIds);
        ArgumentNullException.ThrowIfNull(allocations);

        if (totalGlobalCost < 0)
        {
            throw new ArgumentException("Total global cost cannot be negative.", nameof(totalGlobalCost));
        }

        GlobalExpenseIds = globalExpenseIds.Distinct().ToList();
        PlotAllocations = allocations.ToList();

        TotalGlobalCost = decimal.Round(totalGlobalCost, 2, MidpointRounding.AwayFromZero);
    }
}
