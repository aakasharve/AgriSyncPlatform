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
///   2. enforce per-phone rate limits (plan §5.2 — 3 per 15min, 6 per 24h).
///   3. expire any still-Pending challenge for this phone (so the partial
///      unique index stays satisfied when we insert the new one).
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
            return Result.Failure<StartOtpResult>(new Error("otp.invalid_phone", ex.Message));
        }

        var utcNow = clock.UtcNow;

        var shortWindowStart = utcNow - _policy.ShortWindow;
        var shortWindowCount = await otpRepository.CountIssuedSinceAsync(phone.Value, shortWindowStart, ct);
        if (shortWindowCount >= _policy.MaxShortWindowRequests)
        {
            return Result.Failure<StartOtpResult>(new Error(
                "otp.rate_limited",
                $"Too many OTPs for this phone. Try again after {_policy.ShortWindow.TotalMinutes:F0} minutes."));
        }

        var longWindowStart = utcNow - _policy.LongWindow;
        var longWindowCount = await otpRepository.CountIssuedSinceAsync(phone.Value, longWindowStart, ct);
        if (longWindowCount >= _policy.MaxLongWindowRequests)
        {
            return Result.Failure<StartOtpResult>(new Error(
                "otp.rate_limited_daily",
                "Daily OTP limit reached for this phone."));
        }

        // Explicitly expire any outstanding Pending challenge for this
        // phone before issuing a new one. Keeps the partial unique index
        // satisfied and invalidates any leaked older code.
        var outstanding = await otpRepository.GetPendingByPhoneAsync(phone.Value, ct);
        outstanding?.ExpireManually(utcNow);

        var code = GenerateOtp(_policy.OtpLength);
        var codeHash = passwordHasher.Hash(code);

        var challenge = OtpChallenge.Issue(
            id: Guid.NewGuid(),
            phoneNumberNormalized: phone.Value,
            otpHash: codeHash,
            utcNow: utcNow,
            ttl: TimeSpan.FromMinutes(_policy.OtpExpiryMinutes),
            maxAttempts: _policy.MaxVerifyAttempts);

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
            ResendAfterSeconds: (int)(_policy.ShortWindow.TotalSeconds / Math.Max(1, _policy.MaxShortWindowRequests)),
            ProviderName: dispatchResult.Value.ProviderName));
    }

    private static string HashPhone(string phone)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(phone));
        return Convert.ToHexString(bytes)[..16];
    }

    private static string GenerateOtp(int length)
    {
        if (length < 4 || length > 9) length = 6;
        Span<byte> bytes = stackalloc byte[length];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        Span<char> digits = stackalloc char[length];
        for (var i = 0; i < length; i++)
        {
            digits[i] = (char)('0' + (bytes[i] % 10));
        }
        if (digits[0] == '0') digits[0] = '1';
        return new string(digits);
    }
}
