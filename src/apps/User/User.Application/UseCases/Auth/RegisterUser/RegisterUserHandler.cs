using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
using User.Domain.Common;
using User.Domain.Identity;
using User.Domain.Membership;

namespace User.Application.UseCases.Auth.RegisterUser;

public sealed class RegisterUserHandler(
    IUserRepository userRepository,
    IRefreshTokenRepository refreshTokenRepository,
    IPasswordHasher passwordHasher,
    IJwtTokenService jwtTokenService,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<AuthResponse>> HandleAsync(RegisterUserCommand command, CancellationToken ct = default)
    {
        var phone = PhoneNumber.Create(command.Phone);

        if (await userRepository.ExistsByPhoneAsync(phone.Value, ct))
        {
            return Result.Failure<AuthResponse>(UserErrors.PhoneAlreadyRegistered);
        }

        var utcNow = clock.UtcNow;
        var hash = passwordHasher.Hash(command.Password);

        var user = Domain.Identity.User.Register(
            idGenerator.New(),
            phone,
            command.DisplayName,
            hash,
            utcNow);

        // Add default app membership if specified
        if (!string.IsNullOrWhiteSpace(command.AppId))
        {
            var role = Enum.TryParse<AppRole>(command.Role, ignoreCase: true, out var parsedRole)
                ? parsedRole
                : AppRole.PrimaryOwner;

            user.AddMembership(idGenerator.New(), command.AppId, role, utcNow);
        }

        await userRepository.AddAsync(user, ct);

        // Generate tokens
        var memberships = user.Memberships
            .Select(m => new MembershipClaim(m.AppId, m.Role.ToString()))
            .ToList();

        var tokens = jwtTokenService.GenerateTokens(user.Id, phone.Value, user.DisplayName, memberships, phoneVerified: user.PhoneVerifiedAtUtc.HasValue);

        // Store refresh token hashed. Use real device metadata from the command when available.
        var session = command.Session;
        var refreshToken = new Domain.Security.RefreshToken(
            idGenerator.New(),
            user.Id,
            RefreshTokenHasher.Hash(tokens.RefreshToken),
            deviceId: session?.DeviceId ?? "unknown",
            deviceName: session?.DeviceName,
            platform: session?.Platform ?? "unknown",
            utcNow,
            utcNow.AddDays(30));

        await refreshTokenRepository.AddAsync(refreshToken, ct);
        await userRepository.SaveChangesAsync(ct);

        return Result.Success(new AuthResponse(user.Id, tokens.AccessToken, tokens.RefreshToken, tokens.ExpiresAtUtc));
    }
}
