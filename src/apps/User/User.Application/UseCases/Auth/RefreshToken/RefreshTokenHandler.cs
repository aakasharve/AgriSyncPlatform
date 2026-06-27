using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
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
        var tokenHash = RefreshTokenHasher.Hash(command.RefreshToken);

        var existingToken = await refreshTokenRepository.GetByTokenHashAsync(tokenHash, ct);

        if (existingToken is null)
        {
            // Unknown token — fail closed.
            return Result.Failure<AuthResponse>(UserErrors.InvalidRefreshToken);
        }

        if (existingToken.IsRevoked)
        {
            // Reuse detected: revoke all active sessions for this user/device.
            await refreshTokenRepository.RevokeActiveForUserDeviceAsync(
                existingToken.UserId, existingToken.DeviceId, utcNow, "reuse_detected", ct);
            await refreshTokenRepository.SaveChangesAsync(ct);
            return Result.Failure<AuthResponse>(UserErrors.InvalidRefreshToken);
        }

        if (!existingToken.IsActive(utcNow))
        {
            // Expired but not revoked — fail closed.
            return Result.Failure<AuthResponse>(UserErrors.InvalidRefreshToken);
        }

        var user = await userRepository.GetByIdAsync(existingToken.UserId, ct);

        if (user is null || !user.IsActive)
        {
            return Result.Failure<AuthResponse>(UserErrors.UserDeactivated);
        }

        // Generate new token pair
        var memberships = user.Memberships
            .Where(m => !m.IsRevoked)
            .Select(m => new MembershipClaim(m.AppId, m.Role.ToString()))
            .ToList();

        var tokens = jwtTokenService.GenerateTokens(user.Id, user.Phone.Value, user.DisplayName, memberships, phoneVerified: user.PhoneVerifiedAtUtc.HasValue);

        // Store new refresh token — preserve device metadata from the old token
        var newRefreshTokenId = idGenerator.New();
        var newRefreshToken = new Domain.Security.RefreshToken(
            newRefreshTokenId,
            user.Id,
            RefreshTokenHasher.Hash(tokens.RefreshToken),
            existingToken.DeviceId,
            existingToken.DeviceName,
            existingToken.Platform,
            utcNow,
            utcNow.AddDays(30));

        // Rotate the old token — marks it revoked with reason "rotated" and links to replacement
        existingToken.MarkRotated(utcNow, newRefreshTokenId);

        await refreshTokenRepository.AddAsync(newRefreshToken, ct);
        await refreshTokenRepository.SaveChangesAsync(ct);

        return Result.Success(new AuthResponse(user.Id, tokens.AccessToken, tokens.RefreshToken, tokens.ExpiresAtUtc));
    }
}
