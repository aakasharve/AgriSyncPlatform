namespace User.Application.Ports;

public sealed record TokenPair(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc);

public interface IJwtTokenService
{
    TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships);
}

public sealed record MembershipClaim(string AppId, string Role);
