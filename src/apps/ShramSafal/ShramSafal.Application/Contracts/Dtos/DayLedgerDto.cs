namespace ShramSafal.Application.Contracts.Dtos;

public sealed record DayLedgerDto(
    Guid Id,
    Guid FarmId,
    Guid SourceCostEntryId,
    DateOnly LedgerDate,
    string AllocationBasis,
    Guid CreatedByUserId,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    IReadOnlyList<DayLedgerAllocationDto> Allocations);
