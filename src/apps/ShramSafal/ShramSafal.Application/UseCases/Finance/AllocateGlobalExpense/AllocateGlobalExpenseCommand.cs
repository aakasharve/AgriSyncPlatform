namespace ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;

public sealed record AllocateGlobalExpenseCommand(
    Guid CostEntryId,
    string AllocationBasis,
    IReadOnlyList<AllocateGlobalExpenseAllocationCommand> Allocations,
    Guid CreatedByUserId,
    Guid? DayLedgerId = null,
    string? ActorRole = null,
    string? ClientCommandId = null);

public sealed record AllocateGlobalExpenseAllocationCommand(
    Guid PlotId,
    decimal Amount);
