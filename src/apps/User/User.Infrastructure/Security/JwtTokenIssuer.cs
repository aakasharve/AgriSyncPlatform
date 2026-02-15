using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using AgriSync.BuildingBlocks.Auth.Jwt;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using User.Application.Ports;

namespace User.Infrastructure.Security;

internal sealed class JwtTokenIssuer(IOptions<JwtOptions> jwtOptions) : IJwtTokenService
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
