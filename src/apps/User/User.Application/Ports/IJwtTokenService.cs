namespace User.Application.Ports;

public sealed record TokenPair(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc);

public interface IJwtTokenService
{
    /// <summary>
    /// Legacy password-login token path. Carries membership claims.
    /// Slated for removal once the web client migrates entirely to OTP.
    /// </summary>
    TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships);

    /// <summary>
    /// Phase 3 identity-only token per plan §4.2. The JWT carries only
    /// <c>sub</c>, <c>phone_verified</c>, <c>iat</c>, <c>exp</c>, <c>jti</c>.
    /// No role, no farm id, no account id — those are resolved
    /// server-side per request from <c>FarmMembership</c> +
    /// <c>OwnerAccount</c> reads.
    /// </summary>
    TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified);
}

public sealed record MembershipClaim(string AppId, string Role);
