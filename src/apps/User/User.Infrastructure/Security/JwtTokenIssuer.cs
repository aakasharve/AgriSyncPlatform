using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using AgriSync.BuildingBlocks.Auth.Jwt;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using User.Application.Ports;

namespace User.Infrastructure.Security;

internal sealed class JwtTokenIssuer(
    IOptions<JwtOptions> jwtOptions) : IJwtTokenService
{
    private readonly JwtOptions _options = jwtOptions.Value;

    public TokenPair GenerateTokens(
        Guid userId,
        string phone,
        string displayName,
        IReadOnlyCollection<MembershipClaim> memberships)
    {
        var utcNow = DateTime.UtcNow;
        var expiresAt = utcNow.AddMinutes(_options.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("phone", phone),
            new("display_name", displayName)
        };

        foreach (var m in memberships)
        {
            claims.Add(new Claim("membership", $"{m.AppId}:{m.Role}"));
        }

        // Note: prior to W0-B, this issuer also stamped a `membership: shramsafal:admin`
        // claim for userIds listed in appsettings.Admins[]. That path is removed.
        // Admin status is now resolved per-request from ssf.organization_memberships
        // by IEntitlementResolver, so admin grants take effect on the NEXT request
        // after a UI-driven grant — no token revocation needed (tokens are identity,
        // not authorization). See PlatformAdminBridgeSeeder for the transition seed.

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: utcNow,
            expires: expiresAt,
            signingCredentials: credentials);

        var accessToken = new JwtSecurityTokenHandler().WriteToken(token);
        var refreshToken = Convert.ToBase64String(Guid.NewGuid().ToByteArray())
            + Convert.ToBase64String(Guid.NewGuid().ToByteArray());

        return new TokenPair(accessToken, refreshToken, expiresAt);
    }

    public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified)
    {
        var utcNow = DateTime.UtcNow;
        var expiresAt = utcNow.AddMinutes(_options.AccessTokenMinutes);

        // Plan §4.2 — identity-only claim set. Anything else is a server
        // lookup per request.
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("phone_verified", phoneVerified ? "true" : "false"),
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: utcNow,
            expires: expiresAt,
            signingCredentials: credentials);

        var accessToken = new JwtSecurityTokenHandler().WriteToken(token);
        var refreshToken = Convert.ToBase64String(Guid.NewGuid().ToByteArray())
            + Convert.ToBase64String(Guid.NewGuid().ToByteArray());

        return new TokenPair(accessToken, refreshToken, expiresAt);
    }
}
