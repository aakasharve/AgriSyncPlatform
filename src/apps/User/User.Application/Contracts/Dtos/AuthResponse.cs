namespace User.Application.Contracts.Dtos;

public sealed record AuthResponse(
    Guid UserId,
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresAtUtc,
    // The stored refresh credential's own expiry (~30 days). ExpiresAtUtc above is the
    // ACCESS token's (~15 min). The web cookie must follow THIS one. Never serialised to clients.
    DateTime RefreshExpiresAtUtc,
    // spec: plr-d10 lane NP-1 — true while this phone has not answered the new-phone question; the
    // access token then opens nothing but the answer. AccountName is the account's display name,
    // sent ONLY with the question (null otherwise).
    bool DeviceCheckRequired = false,
    string? AccountName = null);
