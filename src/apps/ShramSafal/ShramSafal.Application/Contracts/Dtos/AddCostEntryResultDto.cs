namespace ShramSafal.Application.Contracts.Dtos;

public sealed record AddCostEntryResultDto(
    CostEntryDto Entry,
    bool IsPotentialDuplicate);
