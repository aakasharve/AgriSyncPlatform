using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using User.Application.Ports;
using User.Domain.Identity;

namespace User.Application.UseCases.Auth.TestLogin;

/// <summary>
/// SARVAM_DEPLOY_READINESS gate B6 enabler — issues a JWT for an
/// explicitly allowlisted pre-seeded test user, bypassing the SMS
/// OTP round-trip.
///
/// <para>
/// <b>Two-gate access control.</b>
/// <list type="number">
///   <item><see cref="TestLoginOptions.Enabled"/> MUST be <c>true</c>
///         (otherwise the handler returns
///         <c>test_login.disabled</c>). The endpoint registration in
///         <c>AuthEndpoints</c> ALSO checks this flag — when it is
///         <c>false</c> the endpoint is not even registered, so
///         requests return 404 long before this handler runs. The
///         handler's own check is defense-in-depth.</item>
///   <item>The requested phone (after
///         <c>PhoneNumber.Create</c> normalization) MUST appear in
///         <see cref="TestLoginOptions.AllowedPhoneNumbersE164"/>.
///         Non-allowlisted phones return
///         <c>test_login.phone_not_allowlisted</c>.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Never creates users.</b> If the allowlisted phone has no user
/// in the database, returns <c>test_login.user_not_found</c> — fail
/// closed. Real OTP flow (<c>VerifyOtpHandler</c>) auto-registers
/// new users on first login; this handler deliberately does not, so
/// test-login can never produce a real-data side effect on a fresh
/// environment.
/// </para>
///
/// <para>
/// <b>JWT shape parity.</b> Issues the same identity-only token shape
/// as <see cref="VerifyOtp.VerifyOtpHandler"/> via the same
/// <see cref="IJwtTokenService.GenerateIdentityTokens"/> call.
/// Downstream authorization (farm membership, role claims, etc.)
/// resolves from the database the same way it would after an OTP
/// login — there is no "test user" role; the user IS the same User
/// row, just reached via a different door.
/// </para>
///
/// <para>
/// <b>Audit + logging.</b> Every test-login call (success or failure)
/// logs an Information-level event with the phone tail so the founder
/// can grep the audit trail. The
/// <c>WARN_TEST_LOGIN_ENABLED_IN_ENVIRONMENT</c> log line fires at
/// startup (see <c>UserApi.DependencyInjection</c>) so any operator
/// scanning logs sees that the bypass is wired.
/// </para>
/// </summary>
public sealed class TestLoginHandler(
    IOptions<TestLoginOptions> optionsAccessor,
    IUserRepository userRepository,
    IRefreshTokenRepository refreshTokenRepository,
    IJwtTokenService jwtTokenService,
    IIdGenerator idGenerator,
    IClock clock,
    ILogger<TestLoginHandler> logger)
{
    private readonly TestLoginOptions _options = optionsAccessor.Value;

    public async Task<Result<TestLoginResult>> HandleAsync(TestLoginCommand command, CancellationToken ct = default)
    {
        // Gate 1: master switch. Defense-in-depth — the endpoint
        // should never even be registered when this is false. If we
        // reach this code with the flag off, the wiring layer is
        // broken; fail closed and log loudly.
        if (!_options.Enabled)
        {
            logger.LogWarning(
                "TestLoginHandler reached with TestLogin.Enabled=false; endpoint registration is leaking. Failing closed.");
            return Result.Failure<TestLoginResult>(Error.Forbidden(
                "test_login.disabled",
                "Test-login is disabled."));
        }

        PhoneNumber phone;
        try
        {
            phone = PhoneNumber.Create(command.Phone);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<TestLoginResult>(Error.Validation("test_login.invalid_phone", ex.Message));
        }

        // Gate 2: allowlist. The allowlist is compared against the
        // post-normalization PhoneNumber.Value (10-digit Indian form,
        // country-code stripped). Operators configure the allowlist
        // in normalized form too — see appsettings.Development.example.
        if (!_options.AllowedPhoneNumbersE164.Contains(phone.Value, StringComparer.Ordinal))
        {
            logger.LogInformation(
                "TestLoginHandler DENY: phone ****{Tail} not in allowlist (allowlist size={Count}).",
                phone.Value[^4..], _options.AllowedPhoneNumbersE164.Count);
            return Result.Failure<TestLoginResult>(Error.Forbidden(
                "test_login.phone_not_allowlisted",
                "Phone is not in the test-login allowlist."));
        }

        // Resolve the existing user. test-login NEVER auto-creates —
        // that's a deliberate departure from VerifyOtpHandler. Allows
        // ops to drop the allowlist into prod, point at the founder
        // seed user, and know with certainty that no extra User row
        // can land via this surface.
        var user = await userRepository.GetByPhoneAsync(phone.Value, ct);
        if (user is null)
        {
            logger.LogWarning(
                "TestLoginHandler DENY: allowlisted phone ****{Tail} has no User row; not auto-creating.",
                phone.Value[^4..]);
            return Result.Failure<TestLoginResult>(Error.NotFound(
                "test_login.user_not_found",
                "No user exists for this allowlisted phone. Test-login does not auto-create users."));
        }

        var utcNow = clock.UtcNow;

        // Revoke old refresh tokens, mirror VerifyOtpHandler's
        // session-rotation behavior so a real OTP login from the same
        // user later cleanly supersedes the test-login session.
        await refreshTokenRepository.RevokeAllForUserAsync(user.Id, utcNow, ct);

        var tokens = jwtTokenService.GenerateIdentityTokens(user.Id, phoneVerified: true);

        var refreshToken = new Domain.Security.RefreshToken(
            idGenerator.New(),
            user.Id,
            tokens.RefreshToken,
            utcNow,
            utcNow.AddDays(30));

        await refreshTokenRepository.AddAsync(refreshToken, ct);
        await refreshTokenRepository.SaveChangesAsync(ct);

        logger.LogInformation(
            "TestLoginHandler ALLOW: issued tokens for user {UserId} (phone ****{Tail}).",
            user.Id, phone.Value[^4..]);

        return Result.Success(new TestLoginResult(
            UserId: user.Id,
            AccessToken: tokens.AccessToken,
            RefreshToken: tokens.RefreshToken,
            ExpiresAtUtc: tokens.ExpiresAtUtc));
    }
}
