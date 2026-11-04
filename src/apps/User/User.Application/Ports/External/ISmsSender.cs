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

    /// <summary>
    /// spec: plr-d10 lane WID — the same gateway with ANOTHER DLT-approved template (a worker's one-time code; never the
    /// login OTP's template). Default: refused, so an adapter that cannot do it says so rather than sending the wrong text.
    /// </summary>
    Task<Result<SmsDispatchReceipt>> SendCodeWithTemplateAsync(
        string phoneNumberInternational,
        string code,
        string templateId,
        CancellationToken cancellationToken = default)
        => Task.FromResult(Result.Failure<SmsDispatchReceipt>(
            Error.Internal("sms.template_not_supported", "This SMS adapter cannot send with another template.")));
}

/// <summary>
/// Gateway response. <see cref="ProviderRequestId"/> is the value we
/// persist on the OtpChallenge for delivery-trace audits.
/// </summary>
public sealed record SmsDispatchReceipt(string ProviderRequestId, string ProviderName);
