using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using User.Application.Ports.External;

namespace User.Infrastructure.Otp;

/// <summary>
/// Development-only SMS sender. Logs the OTP to the console instead of
/// dispatching anything. Selected via <c>Msg91:UseDevStub=true</c>.
///
/// DO NOT register this adapter when <c>ASPNETCORE_ENVIRONMENT</c> is
/// Production. Startup fails loudly if someone tries.
/// </summary>
internal sealed class DevStubSmsSender(ILogger<DevStubSmsSender> logger) : ISmsSender
{
    private const string ProviderName = "dev-stub";

    public Task<Result<SmsDispatchReceipt>> SendOtpAsync(
        string phoneNumberInternational,
        string otpCode,
        CancellationToken cancellationToken = default)
    {
        logger.LogWarning(
            "[DEV STUB OTP] Would have texted phone {Phone} with code {Otp}. " +
            "Use the code printed here to verify; no real SMS was sent.",
            phoneNumberInternational,
            otpCode);

        var receipt = new SmsDispatchReceipt($"devstub-{Guid.NewGuid():N}", ProviderName);
        return Task.FromResult(Result.Success(receipt));
    }
}
