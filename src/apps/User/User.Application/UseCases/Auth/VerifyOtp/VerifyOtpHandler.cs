using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using User.Application.Ports;
using User.Domain.Identity;
using User.Domain.Security;

namespace User.Application.UseCases.Auth.VerifyOtp;

/// <summary>
/// Validates an OTP and either logs in the existing user or creates a new
/// one. Emits an identity-only JWT (plan §4.2) — no role / farm / account
/// claims.
///
/// Invariant I1 is preserved: lookup by <c>PhoneNumberNormalized</c>
/// before Register. A duplicate phone can never create a second User.
///
/// Spec §5.4 + §8.6.2: re-submitting the same valid OTP is idempotent
/// in the sense that the caller receives the same identity back. The
/// challenge itself, however, can only be Consumed once — a second
/// correct submission on the same challenge returns
/// <c>AlreadyConsumed</c>, because the challenge row transitions to
/// terminal state. Callers who want a fresh token after an expired
/// session should hit refresh-token, not re-verify.
/// </summary>
public sealed class VerifyOtpHandler(
    IOtpChallengeRepository otpRepository,
    IUserRepository userRepository,
    IRefreshTokenRepository refreshTokenRepository,
    IPasswordHasher passwordHasher,
    IJwtTokenService jwtTokenService,
    IIdGenerator idGenerator,
    IClock clock,
    ILogger<VerifyOtpHandler> logger,
    IAnalyticsWriter analytics)
{
    public async Task<Result<VerifyOtpResult>> HandleAsync(VerifyOtpCommand command, CancellationToken ct = default)
    {
        PhoneNumber phone;
        try
        {
            phone = PhoneNumber.Create(command.Phone);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<VerifyOtpResult>(Error.Validation("otp.invalid_phone", ex.Message));
        }

        if (string.IsNullOrWhiteSpace(command.Otp) || command.Otp.Length < 4)
        {
            return Result.Failure<VerifyOtpResult>(Error.Validation("otp.invalid_code", "OTP is required."));
        }

        var challenge = await otpRepository.GetPendingByPhoneAsync(phone.Value, ct);
        if (challenge is null)
        {
            return Result.Failure<VerifyOtpResult>(Error.Unauthenticated(
                "otp.no_pending_challenge",
                "No active OTP for this phone. Request a new code."));
        }

        var utcNow = clock.UtcNow;
        var matches = passwordHasher.Verify(command.Otp, challenge.OtpHash);
        var outcome = challenge.Verify(matches, utcNow);

        // Persist the attempt-count / terminal status regardless of outcome.
        await otpRepository.SaveChangesAsync(ct);

        if (outcome != OtpVerificationOutcome.Success)
        {
            var error = outcome switch
            {
                OtpVerificationOutcome.Mismatch => Error.Unauthenticated("otp.mismatch", "OTP did not match."),
                OtpVerificationOutcome.Expired => Error.Unauthenticated("otp.expired", "OTP has expired. Request a new code."),
                OtpVerificationOutcome.LockedOut => Error.Unauthenticated("otp.locked_out", "Too many wrong attempts. Request a new code."),
                OtpVerificationOutcome.AlreadyConsumed => Error.Unauthenticated("otp.already_consumed", "This OTP has already been used."),
                _ => Error.Unauthenticated("otp.unknown", "OTP verification failed."),
            };
            return Result.Failure<VerifyOtpResult>(error);
        }

        // Resolve or create the User — invariant I1.
        var existingUser = await userRepository.GetByPhoneAsync(phone.Value, ct);
        bool createdNewUser = false;

        Domain.Identity.User user;
        if (existingUser is not null)
        {
            user = existingUser;
            // Existing user just completed OTP — stamp the verification timestamp
            // so the semi-literate UI stops showing the "verify phone" banner.
            user.MarkPhoneVerified(utcNow);
            await userRepository.SaveChangesAsync(ct);
        }
        else
        {
            var displayName = string.IsNullOrWhiteSpace(command.DisplayName)
                ? $"User {phone.Value[^4..]}"
                : command.DisplayName.Trim();

            var unusableHash = passwordHasher.Hash(Guid.NewGuid().ToString("N"));
            user = Domain.Identity.User.RegisterViaOtp(
                id: new UserId(Guid.NewGuid()),
                phone: phone,
                displayName: displayName,
                unusablePasswordHash: unusableHash,
                utcNow: utcNow);

            await userRepository.AddAsync(user, ct);
            await userRepository.SaveChangesAsync(ct);
            createdNewUser = true;
            logger.LogInformation("Created new OTP-registered user {UserId} for phone ****{Tail}.",
                user.Id, phone.Value[^4..]);
        }

        // Revoke old refresh tokens, issue identity-only JWT.
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

        // Analytics (Phase 2 Batch A): emit after the last persistence.
        // IAnalyticsWriter swallows failures so the auth path never breaks.
        var phoneHash = HashPhone(phone.Value);
        var propsJson = System.Text.Json.JsonSerializer.Serialize(new { phoneNumberHash = phoneHash });

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.OtpVerified,
            OccurredAtUtc: utcNow,
            ActorUserId: user.Id,
            FarmId: null,
            OwnerAccountId: null,
            ActorRole: "owner",
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: propsJson), ct);

        if (createdNewUser)
        {
            await analytics.EmitAsync(new AnalyticsEvent(
                EventId: Guid.NewGuid(),
                EventType: AnalyticsEventType.UserRegistered,
                OccurredAtUtc: utcNow,
                ActorUserId: user.Id,
                FarmId: null,
                OwnerAccountId: null,
                ActorRole: "owner",
                Trigger: "manual",
                DeviceOccurredAtUtc: null,
                SchemaVersion: "v1",
                PropsJson: propsJson), ct);
        }

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.UserLoggedIn,
            OccurredAtUtc: utcNow,
            ActorUserId: user.Id,
            FarmId: null,
            OwnerAccountId: null,
            ActorRole: "owner",
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: propsJson), ct);

        return Result.Success(new VerifyOtpResult(
            UserId: user.Id,
            AccessToken: tokens.AccessToken,
            RefreshToken: tokens.RefreshToken,
            ExpiresAtUtc: tokens.ExpiresAtUtc,
            CreatedNewUser: createdNewUser));
    }

    private static string HashPhone(string phone)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(phone));
        return Convert.ToHexString(bytes)[..16];
    }
}
