// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56)
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// The new-phone question is enforced by ONE middleware: a phone that has not answered holds a token marked
/// <c>device_check = pending</c>, and <c>DeviceCheckGateMiddleware</c> refuses it every signed-in route. The real-Postgres
/// suite (<c>NewPhoneQuestionRealPostgresTests</c>) composes its own host, so this rule pins that the PRODUCTION host
/// composes it too, and where: after authentication (it reads the principal), before authorization (its refusal
/// carries its own code), exactly once.
/// </summary>
public sealed class DeviceCheckGateRules
{
    [Fact]
    public void Program_runs_the_new_phone_gate_once_between_authentication_and_authorization()
    {
        var program = File.ReadAllText(Path.Combine(TestPathHelper.GetSolutionRoot(), "AgriSync.Bootstrapper", "Program.cs"));

        var authentication = program.IndexOf("app.UseAuthentication();", StringComparison.Ordinal);
        var gate = program.IndexOf("app.UseDeviceCheckGate();", StringComparison.Ordinal);
        var authorization = program.IndexOf("app.UseAuthorization();", StringComparison.Ordinal);

        Assert.True(authentication >= 0, "Program.cs must call app.UseAuthentication().");
        Assert.True(gate >= 0, "Program.cs must call app.UseDeviceCheckGate() — without it a phone that never answered the new-phone question reads the account's farms.");
        Assert.True(authorization >= 0, "Program.cs must call app.UseAuthorization().");
        Assert.True(authentication < gate && gate < authorization,
            "app.UseDeviceCheckGate() must sit after app.UseAuthentication() and before app.UseAuthorization().");
        Assert.Equal(gate, program.LastIndexOf("app.UseDeviceCheckGate();", StringComparison.Ordinal));
    }
}
