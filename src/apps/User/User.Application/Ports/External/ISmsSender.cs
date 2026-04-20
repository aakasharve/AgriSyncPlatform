using AgriSync.BuildingBlocks.Results;

namespace User.Application.Ports.External;

/// <summary>
/// SMS gateway port. The only adapter we ship today is
/// <c>Msg91SmsSender</c> (production) paired with <c>DevStubSmsSender</c>
/// for local development when no DLT template / internet is available.
///
/// Any future provider (Twilio Verify, AWS Notify, Fast2SMS) plugs in by
/// implementing this interface — use cases do not change.
/// </summary>
public interface ISmsSender
{
    Task<Result<SmsDispatchReceipt>> SendOtpAsync(
        string phoneNumberInternational,
        string otpCode,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Gateway response. <see cref="ProviderRequestId"/> is the value we
/// persist on the OtpChallenge for delivery-trace audits.
/// </summary>
public sealed record SmsDispatchReceipt(string ProviderRequestId, string ProviderName);
