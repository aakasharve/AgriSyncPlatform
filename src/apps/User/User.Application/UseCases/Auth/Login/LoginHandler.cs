using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
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

        // The password sign-in path is, by design (auth-rework 2026-06-03), the
        // internal test user only — there is no public password registration; real
        // users are OTP-only. That account is trusted, so a successful password
        // login is treated as phone-verified: stamp it if the seeded row was created
        // with a null PhoneVerifiedAtUtc, so the issued token (and every refresh,
        // which reads this same state) carries phone_verified=true and the
        // /bootstrap/first-farm gate passes.
        if (!user.PhoneVerifiedAtUtc.HasValue)
        {
            user.MarkPhoneVerified(utcNow);
            await userRepository.SaveChangesAsync(ct);
        }

        // Revoke existing session for the same device only — other device sessions are preserved.
        await refreshTokenRepository.RevokeActiveForUserDeviceAsync(
            user.Id, command.Session.DeviceId, utcNow, "same_device_login", ct);

        // Generate new tokens
        var memberships = user.Memberships
            .Where(m => !m.IsRevoked)
            .Select(m => new MembershipClaim(m.AppId, m.Role.ToString()))
            .ToList();

        var tokens = jwtTokenService.GenerateTokens(user.Id, phone.Value, user.DisplayName, memberships, phoneVerified: user.PhoneVerifiedAtUtc.HasValue);

        // Store new refresh token (hashed), with device metadata
        var newRefreshTokenId = idGenerator.New();
        var refreshToken = new Domain.Security.RefreshToken(
            newRefreshTokenId,
            user.Id,
            RefreshTokenHasher.Hash(tokens.RefreshToken),
            command.Session.DeviceId,
            command.Session.DeviceName,
            command.Session.Platform,
            utcNow,
            utcNow.AddDays(30));

        await refreshTokenRepository.AddAsync(refreshToken, ct);
        await refreshTokenRepository.SaveChangesAsync(ct);

        return Result.Success(new AuthResponse(user.Id, tokens.AccessToken, tokens.RefreshToken, tokens.ExpiresAtUtc));
    }
}
