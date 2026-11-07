using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using AgriSync.BuildingBlocks.Auth.DeviceCheck;
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
        IReadOnlyCollection<MembershipClaim> memberships,
        bool phoneVerified,
        bool deviceCheckPending)
    {
        var utcNow = DateTime.UtcNow;
        var expiresAt = utcNow.AddMinutes(_options.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("phone", phone),
            new("display_name", displayName),
            // Parity with GenerateIdentityTokens (the OTP path). Without this the
            // password/refresh token lacked phone_verified entirely, so the
            // /bootstrap/first-farm gate 403'd ("Verify your phone first.").
            new("phone_verified", phoneVerified ? "true" : "false")
        };

        foreach (var m in memberships)
        {
            claims.Add(new Claim("membership", $"{m.AppId}:{m.Role}"));
        }

        AddDeviceCheckClaim(claims, deviceCheckPending);

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

    public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending)
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

        AddDeviceCheckClaim(claims, deviceCheckPending);

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

    /// <summary>
    /// spec: plr-d10 lane NP-1 — a phone that has not answered the new-phone question gets a token the
    /// server's <see cref="DeviceCheckGateMiddleware"/> serves nothing to. A known phone's token has no such claim.
    /// </summary>
    private static void AddDeviceCheckClaim(List<Claim> claims, bool deviceCheckPending)
    {
        if (deviceCheckPending)
        {
            claims.Add(new Claim(DeviceCheckClaims.Type, DeviceCheckClaims.Pending));
        }
    }
}
