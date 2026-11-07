using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
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
        DeviceCheckState? hold = null;

        Domain.Identity.User user;
        if (existingUser is not null)
        {
            user = existingUser;

            // spec: plr-d10 lane NP-1 (founder D-56) — a number can pass to a stranger after it was switched off, and
            // the SMS code then reaches HIM. On a phone this account has never confirmed, the session is HELD: its
            // token opens nothing but the one-time "is this your account?" answer. The phone that made the account
            // (below) and every phone signed in before this question existed are known.
            hold = await NewPhoneQuestion.HoldForSmsSignInAsync(refreshTokenRepository, user.Id, command.Session.DeviceId, ct);

            // Existing user just completed OTP — stamp the verification timestamp
            // so the semi-literate UI stops showing the "verify phone" banner.
            //
            // spec I19 (pre-launch repair, D-23): that is ALL an SMS sign-in does to an existing
            // account. It never clears a password, never changes AuthMode and never revokes other
            // sessions — real owners sign in with a password too (the admin console accepts only
            // phone + password), and nothing in the data tells their password from a stranger's.
            // The back door is closed elsewhere: password self-registration is off by default and
            // a password login never marks a number verified.
            //
            // lane NP-1 (CTO call D-85): on a HELD phone not even that — the account must not change for someone who
            // may answer "नाही". The stamp lands when he answers "होय" (AnswerDeviceCheckHandler).
            if (hold is null)
            {
                user.MarkPhoneVerified(utcNow);
                await userRepository.SaveChangesAsync(ct);
            }
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

        // Revoke old refresh tokens for this device only — other device sessions preserved.
        // lane FIX-1 (register F131; NP-1 review M1): a HELD session (a phone this account has never confirmed — possibly a
        // stranger's) replaces only the HELD rows of its device id, never the account's normal sessions: `unknown` (no id sent:
        // the admin console, phones on 1.0.15–1.0.17) and `legacy` are shared by many sessions, and "the real owner's phones stay
        // signed in". A sign-in on a known device keeps the old behaviour.
        if (hold is not null)
        {
            await refreshTokenRepository.RevokeHeldForUserDeviceAsync(
                user.Id, command.Session.DeviceId, utcNow, "same_device_login", ct);
        }
        else
        {
            await refreshTokenRepository.RevokeActiveForUserDeviceAsync(
                user.Id, command.Session.DeviceId, utcNow, "same_device_login", ct);
        }

        var tokens = jwtTokenService.GenerateIdentityTokens(user.Id, phoneVerified: true, deviceCheckPending: hold is not null);

        var refreshToken = new Domain.Security.RefreshToken(
            idGenerator.New(),
            user.Id,
            RefreshTokenHasher.Hash(tokens.RefreshToken),
            command.Session.DeviceId,
            command.Session.DeviceName,
            command.Session.Platform,
            utcNow,
            utcNow.Add(RefreshTokenPolicy.Lifetime));
        if (hold is { } asked)
        {
            refreshToken.HoldForDeviceCheck(asked);
        }

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
            CreatedNewUser: createdNewUser,
            RefreshExpiresAtUtc: refreshToken.ExpiresAtUtc,
            DeviceCheckRequired: hold is not null,
            AccountName: hold is not null ? user.DisplayName : null));
    }

    private static string HashPhone(string phone)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(phone));
        return Convert.ToHexString(bytes)[..16];
    }
}
