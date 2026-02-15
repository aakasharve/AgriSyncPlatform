using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Domain.Common;
using User.Domain.Identity;

namespace User.Application.UseCases.Auth.Login;

public sealed class LoginHandler(
    IUserRepository userRepository,
    IRefreshTokenRepository refreshTokenRepository,
    IPasswordHasher passwordHasher,
    IJwtTokenService jwtTokenService,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<AuthResponse>> HandleAsync(LoginCommand command, CancellationToken ct = default)
    {
        var phone = PhoneNumber.Create(command.Phone);
        var user = await userRepository.GetByPhoneAsync(phone.Value, ct);

        if (user is null)
        {
            return Result.Failure<AuthResponse>(UserErrors.InvalidCredentials);
        }

        if (!user.IsActive)
        {
            return Result.Failure<AuthResponse>(UserErrors.UserDeactivated);
        }

        if (!passwordHasher.Verify(command.Password, user.Credential.PasswordHash))
        {
            return Result.Failure<AuthResponse>(UserErrors.InvalidCredentials);
        }

        var utcNow = clock.UtcNow;

        // Revoke existing refresh tokens
        await refreshTokenRepository.RevokeAllForUserAsync(user.Id, utcNow, ct);

        // Generate new tokens
        var memberships = user.Memberships
            .Where(m => !m.IsRevoked)
            .Select(m => new MembershipClaim(m.AppId, m.Role.ToString()))
            .ToList();

        var tokens = jwtTokenService.GenerateTokens(user.Id, phone.Value, user.DisplayName, memberships);

        // Store new refresh token
        var refreshToken = new Domain.Security.RefreshToken(
            idGenerator.New(),
            user.Id,
            tokens.RefreshToken,
            utcNow,
            utcNow.AddDays(30));

        await refreshTokenRepository.AddAsync(refreshToken, ct);
        await refreshTokenRepository.SaveChangesAsync(ct);

        return Result.Success(new AuthResponse(user.Id, tokens.AccessToken, tokens.RefreshToken, tokens.ExpiresAtUtc));
    }
}
