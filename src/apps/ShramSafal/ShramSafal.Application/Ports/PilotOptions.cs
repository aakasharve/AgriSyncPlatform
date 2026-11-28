namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d10 pilot lane NO-TRIAL (founder, 28 Nov 2026: "the 21-day trial is for the commercial purposes, commercial use. When
/// pilot testing completes, then that is going to happen. For the pilot testing, we need to prove the thesis …").
///
/// <para>The ONE server setting <c>Pilot:TrialEnforcementEnabled</c>. <b>Default false</b> (and false in every shipped settings file):
/// the pilot runs with NO time limit. The founder turns it on after the pilot. With it off:</para>
/// <list type="bullet">
/// <item>the entitlement policy never refuses a farm because its trial or subscription ran out, because it has no subscription row,
/// or because its access extension is missing or has ended — it allows with <see cref="EntitlementReason.Pilot"/>;</item>
/// <item>the nightly <c>SubscriptionReconciliationJob</c> marks NOTHING Expired (Expired is one-way: <c>Subscription.Activate</c>
/// refuses it);</item>
/// <item>the streaming AI check allows too (it asks the same policy).</item>
/// </list>
/// <para>Nothing else moves: membership, roles, RLS and permission checks are untouched, and a deliberately Canceled or Suspended
/// account (status 5 / 6 — an act, not a date) is refused exactly as before. Those are also the two statuses the one-time pilot
/// grant (<c>20261027040015_AddAccessExtensions</c>) left out, so this switch covers exactly the accounts that grant covered,
/// without its 31 Dec 2026 end date. With it ON every decision is the one the server made before this setting existed.</para>
/// </summary>
public sealed class PilotOptions
{
    public const string SectionName = "Pilot";

    /// <summary>False (the default) = the pilot: no trial or access-extension time limit. True = the commercial rules.</summary>
    public bool TrialEnforcementEnabled { get; set; }

    /// <summary>
    /// True when enforcement is off and the owner account's subscription status (<c>null</c> = no row) is one a time limit
    /// produces or leaves open: none, Trialing (1), Active (2), PastDue (3) or Expired (4). Canceled (5), Suspended (6) and any
    /// unknown value stay closed (fail closed). Always false when enforcement is on.
    /// </summary>
    public bool KeepsOpen(int? subscriptionStatus) =>
        !TrialEnforcementEnabled && subscriptionStatus is null or 1 or 2 or 3 or 4;
}
