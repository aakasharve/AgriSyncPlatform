namespace User.Application.Ports;

public sealed record TokenPair(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc);

public interface IJwtTokenService
{
    /// <summary>
    /// Legacy password-login token path. Carries membership claims AND the
    /// <c>phone_verified</c> claim (consumed by /bootstrap/first-farm). Slated
    /// for removal once the web client migrates entirely to OTP.
    /// </summary>
    /// <param name="deviceCheckPending">spec: plr-d10 lane NP-1 — true for a phone that has not yet answered the
    /// new-phone question: the access token then carries <c>device_check = pending</c> and the server's gate serves
    /// it nothing. Required, never defaulted, so every caller decides.</param>
    TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending);

    /// <summary>
    /// Phase 3 identity-only token per plan §4.2. The JWT carries only
    /// <c>sub</c>, <c>phone_verified</c>, <c>iat</c>, <c>exp</c>, <c>jti</c>
    /// (and <c>device_check = pending</c> while the new-phone question is open, lane NP-1).
    /// No role, no farm id, no account id — those are resolved
    /// server-side per request from <c>FarmMembership</c> +
    /// <c>OwnerAccount</c> reads.
    /// </summary>
    TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending);
}

public sealed record MembershipClaim(string AppId, string Role);
