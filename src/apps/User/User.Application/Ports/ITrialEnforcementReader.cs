namespace User.Application.Ports;

/// <summary>
/// spec: plr-d10 pilot lane NO-TRIAL (founder, 28 Nov 2026: nothing about the trial applies during the pilot) — whether the trial /
/// plan time limit is enforced. The setting (<c>Pilot:TrialEnforcementEnabled</c>) belongs to the composition root, which implements
/// this port, so this context never imports another context's settings. False = the pilot: <c>/me/context</c> sends no
/// <c>plan_expiring</c> / <c>plan_expired</c> alert.
/// </summary>
public interface ITrialEnforcementReader
{
    bool TrialEnforcementEnabled { get; }
}
