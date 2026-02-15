namespace ShramSafal.Application.UseCases.Finance.CorrectCostEntry;

public sealed record CorrectCostEntryCommand(
    Guid CostEntryId,
    decimal CorrectedAmount,
    string CurrencyCode,
    string Reason,
    Guid CorrectedByUserId,
    Guid? FinanceCorrectionId = null);
