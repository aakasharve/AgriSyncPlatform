namespace User.Api.Endpoints;

/// <param name="DeviceCheckRequired">spec: plr-d10 lane NP-1 — true while this phone has not answered the one-time
/// "is this your account?" question: the access token opens nothing until it answers (POST /user/auth/device-check).
/// Older apps ignore the field (P11).</param>
/// <param name="AccountName">The account's display name for that question; null unless the question is open.</param>
public sealed record AuthResponseBody(
    Guid UserId,
    string AccessToken,
    DateTime ExpiresAtUtc,
    bool DeviceCheckRequired = false,
    string? AccountName = null);

/// <summary>
/// Response body returned ONLY to native (Android) clients that send
/// <c>X-Client-Platform: android</c>. Carries the raw refresh token so
/// the Capacitor app can persist it in the Android Keystore.
/// Web clients receive <see cref="AuthResponseBody"/> (token-less) and rely
/// on the HttpOnly cookie set in the same response.
/// </summary>
public sealed record NativeAuthResponseBody(
    Guid UserId,
    string AccessToken,
    DateTime ExpiresAtUtc,
    string RefreshToken,
    bool DeviceCheckRequired = false,
    string? AccountName = null);
