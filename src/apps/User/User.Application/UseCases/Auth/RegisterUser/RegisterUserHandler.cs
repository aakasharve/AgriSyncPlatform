using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Options;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
using User.Domain.Common;
using User.Domain.Identity;

namespace User.Application.UseCases.Auth.RegisterUser;

/// <summary>
/// Password self-registration — <c>POST /user/auth/register</c>.
///
/// <para>spec I19 (pre-launch repair, D-23; founder 26 Oct: "the password login was made for trial
/// and test purpose only"). Before this change any caller could register ANY phone number with a
/// password and a self-chosen account role (default PrimaryOwner), and one password login then
/// marked the number verified. Now:</para>
/// <list type="number">
/// <item>Closed unless <see cref="PasswordRegistrationOptions.AllowPasswordRegistration"/> is on
/// (default off everywhere) — refused with <see cref="UserErrors.PasswordRegistrationClosed"/>.</item>
/// <item>A role field is refused (<see cref="UserErrors.RegisterRoleNotAllowed"/>), and no app
/// membership is ever written, so the account's role is the plain default — the same as an
/// SMS-registered account.</item>
/// <item>The account is NOT phone-verified. Only a correct SMS code verifies a number.</item>
/// </list>
/// </summary>
public sealed class RegisterUserHandler(
    IUserRepository userRepository,
    IRefreshTokenRepository refreshTokenRepository,
    IPasswordHasher passwordHasher,
    IJwtTokenService jwtTokenService,
    IIdGenerator idGenerator,
    IClock clock,
    IOptions<PasswordRegistrationOptions> registrationOptions)
{
    public async Task<Result<AuthResponse>> HandleAsync(RegisterUserCommand command, CancellationToken ct = default)
    {
        if (!registrationOptions.Value.AllowPasswordRegistration)
        {
            return Result.Failure<AuthResponse>(UserErrors.PasswordRegistrationClosed);
        }

        if (!string.IsNullOrWhiteSpace(command.Role))
        {
            return Result.Failure<AuthResponse>(UserErrors.RegisterRoleNotAllowed);
        }

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

        await userRepository.AddAsync(user, ct);

        // No membership claims (none were written) and phone_verified=false (never stamped here).
        // Never held (lane NP-1): the phone that makes an account is its first known phone — there is no one to ask.
        var tokens = jwtTokenService.GenerateTokens(user.Id, phone.Value, user.DisplayName, [], phoneVerified: user.PhoneVerifiedAtUtc.HasValue, deviceCheckPending: false);

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
            utcNow.Add(RefreshTokenPolicy.Lifetime));

        await refreshTokenRepository.AddAsync(refreshToken, ct);
        await userRepository.SaveChangesAsync(ct);

        return Result.Success(new AuthResponse(user.Id, tokens.AccessToken, tokens.RefreshToken, tokens.ExpiresAtUtc, refreshToken.ExpiresAtUtc));
    }
}
