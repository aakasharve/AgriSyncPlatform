using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;

public sealed record AllocateGlobalExpenseCommand(
    Guid FarmId,
    Guid RequestedByUserId,
    DateOnly DateKey,
    IReadOnlyList<Guid> CostEntryIds,
    AllocationStrategy Strategy,
    IReadOnlyDictionary<Guid, decimal>? CustomAllocations = null,
    Guid? DayLedgerId = null);
