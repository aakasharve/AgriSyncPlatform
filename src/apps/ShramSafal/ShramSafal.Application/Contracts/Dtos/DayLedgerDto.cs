namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PlotAllocationDto(
    Guid PlotId,
    Guid CropCycleId,
    decimal AllocationPercent,
    decimal AllocatedAmount);

public sealed record DayLedgerDto(
    Guid Id,
    Guid FarmId,
    DateOnly DateKey,
    IReadOnlyList<Guid> GlobalExpenseIds,
    string AllocationStrategy,
    decimal TotalGlobalCost,
    DateTime CreatedAtUtc,
    IReadOnlyList<PlotAllocationDto> PlotAllocations);
