using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using User.Application.Ports;
using User.Application.Ports.External;
using User.Domain.Identity;
using User.Domain.Security;

namespace User.Application.UseCases.Auth.StartOtp;

/// <summary>
/// Issues a one-time code to the caller's phone.
///
/// Flow:
///   1. normalise phone → 10-digit (IN).
///   2. enforce per-phone rate limits (plan §5.2 — 3 per 15min, 6 per 24h) for
///      farmer-app codes; the control-room door's own limits for door codes
///      (CR-3 fix wave S-A1). Each door counts only its own codes.
///   3. expire any still-Pending challenge for this phone and door (so the
///      partial unique index stays satisfied when we insert the new one).
///   4. generate N-digit code, hash, persist challenge.
///   5. dispatch via <see cref="ISmsSender"/>. Bail if send fails.
///
/// The handler never returns the OTP itself — even in dev, only the
/// DevStub logs it.
/// </summary>
public sealed class StartOtpHandler(
    IOtpChallengeRepository otpRepository,
    ISmsSender smsSender,
    IPasswordHasher passwordHasher,
    IOptions<OtpPolicyOptions> options,
    IClock clock,
    ILogger<StartOtpHandler> logger,
    IAnalyticsWriter analytics)
{
    private readonly OtpPolicyOptions _policy = options.Value;

    public async Task<Result<StartOtpResult>> HandleAsync(StartOtpCommand command, CancellationToken ct = default)
    {
        PhoneNumber phone;
        try
        {
            phone = PhoneNumber.Create(command.Phone);
        }
        catch (ArgumentException ex)
        {
            logger.LogWarning(ex, "StartOtp rejected invalid phone.");
            return Result.Failure<StartOtpResult>(Error.Validation("otp.invalid_phone", ex.Message));
        }

        var purpose = command.Purpose;
        if (!Enum.IsDefined(purpose))
        {
            return Result.Failure<StartOtpResult>(Error.Validation("otp.invalid_purpose", "Unknown code purpose."));
        }

        var utcNow = clock.UtcNow;

        // spec: trusted-control-room-2026-11-20 (fix wave S-A1, D-159): each door counts only its own codes. The farmer
        // app keeps plan §5.2 (3 per 15 minutes, 6 per 24 hours) over farmer codes; the control-room door has its own
        // limits over door codes (one per minute, ten per rolling hour, no daily cap).
        var refusal = purpose == OtpPurpose.ControlRoomDoor
            ? await DoorLimitAsync(phone.Value, utcNow, ct)
            : await FarmerLimitAsync(phone.Value, utcNow, ct);
        if (refusal is not null)
        {
            return Result.Failure<StartOtpResult>(refusal);
        }

        // Explicitly expire any outstanding Pending challenge for this
        // phone and door before issuing a new one. Keeps the partial unique
        // index satisfied and invalidates any leaked older code. A code of the
        // other door is never touched (S-A1).
        var outstanding = await otpRepository.GetPendingByPhoneAsync(phone.Value, purpose, ct);
        outstanding?.ExpireManually(utcNow);

        var code = GenerateOtp(_policy.OtpLength);
        var codeHash = passwordHasher.Hash(code);

        var challenge = OtpChallenge.Issue(
            id: Guid.NewGuid(),
            phoneNumberNormalized: phone.Value,
            otpHash: codeHash,
            utcNow: utcNow,
            ttl: TimeSpan.FromMinutes(_policy.OtpExpiryMinutes),
            maxAttempts: _policy.MaxVerifyAttempts,
            purpose: purpose);

        // Dispatch before persisting the new row. If MSG91 is down we do
        // not leave an orphan Pending row that blocks future attempts
        // until TTL.
        var dispatchResult = await smsSender.SendOtpAsync(
            phoneNumberInternational: $"91{phone.Value}",
            otpCode: code,
            cancellationToken: ct);

        if (dispatchResult.IsFailure)
        {
            return Result.Failure<StartOtpResult>(dispatchResult.Error);
        }

        challenge.AttachProviderRequestId(dispatchResult.Value!.ProviderRequestId);

        await otpRepository.AddAsync(challenge, ct);
        await otpRepository.SaveChangesAsync(ct);

        // Analytics (Phase 2 Batch A): emit after the last persistence.
        // ActorRole "system" because the OTP issuer is not an authenticated user yet.
        var propsJson = System.Text.Json.JsonSerializer.Serialize(new { phoneNumberHash = HashPhone(phone.Value) });

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.OtpSent,
            OccurredAtUtc: utcNow,
            ActorUserId: null,
            FarmId: null,
            OwnerAccountId: null,
            ActorRole: "system",
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: propsJson), ct);

        return Result.Success(new StartOtpResult(
            PhoneNumberNormalized: phone.Value,
            ExpiresAtUtc: challenge.ExpiresAtUtc,
            ResendAfterSeconds: purpose == OtpPurpose.ControlRoomDoor
                ? (int)_policy.DoorMinInterval.TotalSeconds
                : (int)(_policy.ShortWindow.TotalSeconds / Math.Max(1, _policy.MaxShortWindowRequests)),
            ProviderName: dispatchResult.Value.ProviderName));
    }

    /// <summary>Plan §5.2 over farmer-app codes only: 3 per 15 minutes, 6 per 24 hours (unchanged answers, P11).</summary>
    private async Task<Error?> FarmerLimitAsync(string phone, DateTime utcNow, CancellationToken ct)
    {
        var shortWindowCount = await otpRepository.CountIssuedSinceAsync(phone, OtpPurpose.FarmerApp, utcNow - _policy.ShortWindow, ct);
        if (shortWindowCount >= _policy.MaxShortWindowRequests)
        {
            return Error.Conflict(
                "otp.rate_limited",
                $"Too many OTPs for this phone. Try again after {_policy.ShortWindow.TotalMinutes:F0} minutes.");
        }

        var longWindowCount = await otpRepository.CountIssuedSinceAsync(phone, OtpPurpose.FarmerApp, utcNow - _policy.LongWindow, ct);
        if (longWindowCount >= _policy.MaxLongWindowRequests)
        {
            return Error.Conflict(
                "otp.rate_limited_daily",
                "Daily OTP limit reached for this phone.");
        }

        return null;
    }

    /// <summary>
    /// S-A1: the control-room door's own limits over door codes only: at most one per number per
    /// <see cref="OtpPolicyOptions.DoorMinInterval"/>, at most <see cref="OtpPolicyOptions.DoorMaxPerHour"/> per rolling
    /// <see cref="OtpPolicyOptions.DoorHourWindow"/>, and no daily cap. The door itself always answers its calm sentence;
    /// a refusal here becomes its <c>code_not_sent</c> History line.
    /// </summary>
    private async Task<Error?> DoorLimitAsync(string phone, DateTime utcNow, CancellationToken ct)
    {
        var lastMinute = await otpRepository.CountIssuedSinceAsync(phone, OtpPurpose.ControlRoomDoor, utcNow - _policy.DoorMinInterval, ct);
        if (lastMinute >= 1)
        {
            return Error.Conflict(
                "otp.rate_limited",
                $"One control-room code per {_policy.DoorMinInterval.TotalSeconds:F0} seconds.");
        }

        var lastHour = await otpRepository.CountIssuedSinceAsync(phone, OtpPurpose.ControlRoomDoor, utcNow - _policy.DoorHourWindow, ct);
        if (lastHour >= _policy.DoorMaxPerHour)
        {
            return Error.Conflict(
                "otp.rate_limited_hourly",
                $"At most {_policy.DoorMaxPerHour} control-room codes per hour.");
        }

        return null;
    }

    private static string HashPhone(string phone)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(phone));
        return Convert.ToHexString(bytes)[..16];
    }

    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (fix wave S-A5, AU-M5): a code of <paramref name="length"/> digits (4 to 9;
    /// anything else is 6) drawn UNIFORMLY from <c>10^(length-1)</c> to <c>10^length - 1</c>, so the first digit is never
    /// 0 (the same length and format as before) and no digit or code is likelier than another.
    /// </summary>
    public static string GenerateOtp(int length)
    {
        if (length < 4 || length > 9) length = 6;
        var lowest = 1;
        for (var i = 1; i < length; i++)
        {
            lowest *= 10;
        }

        return System.Security.Cryptography.RandomNumberGenerator.GetInt32(lowest, lowest * 10)
            .ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
}
