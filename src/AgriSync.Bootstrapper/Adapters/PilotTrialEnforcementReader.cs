using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using User.Application.Ports;

namespace AgriSync.Bootstrapper.Adapters;

/// <summary>
/// spec: plr-d10 pilot lane NO-TRIAL — the composition root hands the User context the ONE setting
/// <c>Pilot:TrialEnforcementEnabled</c> (<see cref="PilotOptions"/>), so <c>/me/context</c> follows the same switch as the
/// entitlement policy, the nightly job and the schedule trial rules. Registered in Program.cs beside the other MeContext adapters.
/// </summary>
public sealed class PilotTrialEnforcementReader(IOptions<PilotOptions> options) : ITrialEnforcementReader
{
    public bool TrialEnforcementEnabled => options.Value.TrialEnforcementEnabled;
}
