namespace User.Api.Endpoints;

public sealed record AuthResponseBody(Guid UserId, string AccessToken, DateTime ExpiresAtUtc);

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
    string RefreshToken);
