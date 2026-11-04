using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;
using User.Application.Ports.External;

namespace AgriSync.Bootstrapper.Adapters;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. A worker's one-time code on the EXISTING SMS gateway
/// (User's <see cref="ISmsSender"/>, the one the login OTP uses) with its OWN DLT template. The host registers it only when
/// <c>ShramSafal:WorkerPhoneCode:SmsEnabled</c> is true — i.e. after the founder's DLT approval of that template (with
/// D-52). Lives in the host because only the host may see both modules (no ShramSafal → User reference).
/// </summary>
public sealed class WorkerPhoneCodeSmsBridge(ISmsSender sms, string templateId) : IWorkerPhoneCodeSender
{
    public async Task<Result> SendAsync(string phoneE164, string code, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(templateId))
        {
            return Result.Failure(ShramSafalErrors.WorkerCodeSmsOff);
        }

        // MSG91 takes the number without "+" (country code first), as the login OTP sends it.
        var sent = await sms.SendCodeWithTemplateAsync(phoneE164.TrimStart('+'), code, templateId, ct);
        return sent.IsSuccess ? Result.Success() : Result.Failure(ShramSafalErrors.WorkerCodeSmsFailed);
    }
}
