namespace ShramSafal.Application.Contracts.Dtos;

public sealed record UsersListDto(
    IReadOnlyList<UserSummaryDto> Items,
    int TotalCount,
    int Page,
    int PageSize);

public sealed record UserSummaryDto(
    Guid UserId,
    string Phone,
    string? DisplayName,
    string? Email,
    IReadOnlyList<string> Apps,
    DateTime CreatedAt,
    DateTime? LastLoginAt);
