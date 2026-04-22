namespace ShramSafal.Application.Contracts.Dtos;

public sealed record OpsErrorsPageDto(
    IReadOnlyList<OpsErrorEventDto> Items,
    int TotalCount,
    int Page,
    int PageSize);
