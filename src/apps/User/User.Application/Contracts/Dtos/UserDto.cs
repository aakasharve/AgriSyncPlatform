namespace User.Application.Contracts.Dtos;

public sealed record UserDto(
    Guid Id,
    string Phone,
    string DisplayName,
    bool IsActive,
    DateTime CreatedAtUtc,
    IReadOnlyList<MembershipDto> Memberships);

public sealed record MembershipDto(
    Guid Id,
    string AppId,
    string Role,
    DateTime GrantedAtUtc);
