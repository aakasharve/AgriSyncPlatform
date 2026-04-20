using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using AgriSync.BuildingBlocks.Auth.Jwt;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using User.Application.Ports;

namespace User.Infrastructure.Security;

internal sealed class JwtTokenIssuer(
    IOptions<JwtOptions> jwtOptions,
    IConfiguration configuration) : IJwtTokenService
{
    private readonly JwtOptions _options = jwtOptions.Value;

    // Admin user IDs configured in appsettings (never hardcoded).
    // Format: "Admins": ["00000000-0000-0000-0000-000000000099"]
    private readonly HashSet<Guid> _adminIds = configuration
        .GetSection("Admins")
        .Get<string[]>()
        ?.Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty)
        .Where(g => g != Guid.Empty)
        .ToHashSet()
        ?? [];

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

        // System admin claim — emitted if this userId is in the configured Admins list.
        // This gives the "admin" role without touching the FarmMembership table or AppRole enum.
        if (_adminIds.Contains(userId))
        {
            claims.Add(new Claim("membership", "shramsafal:admin"));
        }

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
