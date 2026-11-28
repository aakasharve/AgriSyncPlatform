using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;

namespace AgriSync.Bootstrapper.Configuration;

/// <summary>
/// spec: plr-d10 pilot lane NO-TRIAL — the ONE startup line that says whether the trial / access-extension time limit is enforced
/// (<see cref="PilotOptions.TrialEnforcementEnabled"/>). Written at Warning in both modes so the production log level (Warning)
/// keeps it: a deploy log then shows which mode the server came up in.
/// </summary>
public static class PilotModeStartupLog
{
    public static string Describe(PilotOptions options) =>
        options.TrialEnforcementEnabled
            ? "Pilot:TrialEnforcementEnabled=true - COMMERCIAL mode: trials, subscription expiry and access-extension end dates are enforced; the nightly job expires overdue subscriptions."
            : "Pilot:TrialEnforcementEnabled=false - PILOT mode: no trial or access-extension time limit; no farm is refused for it and the nightly job expires nothing.";

    public static void Write(PilotOptions options, ILogger logger) =>
        logger.LogWarning("{PilotMode}", Describe(options));
}
