using ShramSafal.Application.Ports.External;
using User.Application.Ports.External;

namespace AgriSync.Bootstrapper.Adapters;

/// <summary>
/// spec: plr-d10 schedule slice 15 (the creator door) - a creator's one-time sign-in code on the EXISTING SMS gateway (User's <see cref="ISmsSender"/>, the one the
/// login OTP uses, with the login OTP's own approved template: it is a login code). Only the SENDING is shared: the code, its row, its attempts and its daily ceiling
/// are the creator door's own, so a code asked for at one door never opens the other. Lives in the host because only the host may see both modules.
/// </summary>
public sealed class CreatorSignInCodeSmsBridge(ISmsSender sms) : ICreatorSignInCodeSender
{
    public async Task<bool> SendAsync(string phone, string code, CancellationToken ct = default)
    {
        // The gateway takes the number with the country code and no "+", as the login OTP sends it.
        var sent = await sms.SendOtpAsync($"91{phone}", code, ct);
        return sent.IsSuccess;
    }
}
