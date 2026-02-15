using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Domain.Common;

namespace User.Application.UseCases.Auth.RefreshToken;

public sealed class RefreshTokenHandler(
    IUserRepository userRepository,
    IRefreshTokenRepository refreshTokenRepository,
    IJwtTokenService jwtTokenService,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<AuthResponse>> HandleAsync(RefreshTokenCommand command, CancellationToken ct = default)
    {
        var utcNow = clock.UtcNow;

        var existingToken = await refreshTokenRepository.GetByTokenAsync(command.RefreshToken, ct);

        if (existingToken is null || !existingToken.IsActive(utcNow))
        {
            return Result.Failure<AuthResponse>(UserErrors.InvalidRefreshToken);
        }

        var user = await userRepository.GetByIdAsync(existingToken.UserId, ct);

        if (user is null || !user.IsActive)
        {
            return Result.Failure<AuthResponse>(UserErrors.UserDeactivated);
        }

        // Revoke the used token (rotation)
        existingToken.Revoke(utcNow);

        // Generate new token pair
        var memberships = user.Memberships
            .Where(m => !m.IsRevoked)
            .Select(m => new MembershipClaim(m.AppId, m.Role.ToString()))
            .ToList();

        var tokens = jwtTokenService.GenerateTokens(user.Id, user.Phone.Value, user.DisplayName, memberships);

        // Store new refresh token
        var newRefreshToken = new Domain.Security.RefreshToken(
            idGenerator.New(),
            user.Id,
            tokens.RefreshToken,
            utcNow,
            utcNow.AddDays(30));

        await refreshTokenRepository.AddAsync(newRefreshToken, ct);
        await refreshTokenRepository.SaveChangesAsync(ct);

        return Result.Success(new AuthResponse(user.Id, tokens.AccessToken, tokens.RefreshToken, tokens.ExpiresAtUtc));
    }
}
