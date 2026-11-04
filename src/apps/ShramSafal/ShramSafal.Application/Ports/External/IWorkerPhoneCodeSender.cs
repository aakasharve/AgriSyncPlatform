using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.Ports.External;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. Sends a worker's one-time code by SMS, on the existing
/// SMS sender with its OWN DLT template (the login OTP's template is not reused).
/// </summary>
/// <remarks>
/// <para><b>Until the founder's DLT approval (shared with D-52), production sending is OFF</b> behind one setting,
/// <c>ShramSafal:WorkerPhoneCode:SmsEnabled</c>: in Production with it off, every send answers
/// <c>identity.sms_off</c> and the phone says "नंतर करा"; nothing pretends to be sent. Outside Production the dev stub
/// logs the code (the test stack reads it there). With it on, the host registers the real sender.</para>
/// <para><b>The SMS reveals no farm data (case 3):</b> the template carries the code only.</para>
/// </remarks>
public interface IWorkerPhoneCodeSender
{
    Task<Result> SendAsync(string phoneE164, string code, CancellationToken ct = default);
}
