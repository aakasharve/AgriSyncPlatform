namespace User.Application.Contracts.Dtos;

public sealed record AuthResponse(
    Guid UserId,
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresAtUtc);
