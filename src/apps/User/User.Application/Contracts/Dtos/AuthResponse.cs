namespace User.Application.Contracts.Dtos;

public sealed record AuthResponse(
    Guid UserId,
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresAtUtc,
    // The stored refresh credential's own expiry (~30 days). ExpiresAtUtc above is the
    // ACCESS token's (~15 min). The web cookie must follow THIS one. Never serialised to clients.
    DateTime RefreshExpiresAtUtc);
