using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Identity;

namespace ShramSafal.Infrastructure.Identity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. The worker-code sender for development and the test
/// stack: it sends nothing and logs the code, with only the last four digits of the number. Never registered in
/// Production (see <see cref="WorkerPhoneCodeSms"/>).
/// </summary>
internal sealed class DevStubWorkerPhoneCodeSender(ILogger<DevStubWorkerPhoneCodeSender> logger) : IWorkerPhoneCodeSender
{
    public Task<Result> SendAsync(string phoneE164, string code, CancellationToken ct = default)
    {
        logger.LogWarning(
            "[DEV STUB WORKER CODE] No SMS sent. Phone ending {PhoneTail}; worker code {WorkerCode}.",
            IndianMobile.Tail(phoneE164),
            code);
        return Task.FromResult(Result.Success());
    }
}

/// <summary>
/// Production until the founder's DLT template approval (with D-52): sending is OFF. Every send answers
/// <c>identity.sms_off</c>; the phone says "नंतर करा" and nothing pretends to have been sent.
/// </summary>
internal sealed class SwitchedOffWorkerPhoneCodeSender : IWorkerPhoneCodeSender
{
    public Task<Result> SendAsync(string phoneE164, string code, CancellationToken ct = default)
        => Task.FromResult(Result.Failure(ShramSafalErrors.WorkerCodeSmsOff));
}

/// <summary>The one setting, and which sender the module registers by default.</summary>
public static class WorkerPhoneCodeSms
{
    /// <summary>
    /// <c>true</c> only once the worker-code DLT template is approved; the HOST then registers the real sender (on the
    /// existing SMS gateway, with the template id in <see cref="TemplateIdKey"/>).
    /// </summary>
    public const string EnabledKey = "ShramSafal:WorkerPhoneCode:SmsEnabled";

    /// <summary>The DLT-approved MSG91 template id for the worker code (never the login OTP's).</summary>
    public const string TemplateIdKey = "ShramSafal:WorkerPhoneCode:Msg91TemplateId";
}
