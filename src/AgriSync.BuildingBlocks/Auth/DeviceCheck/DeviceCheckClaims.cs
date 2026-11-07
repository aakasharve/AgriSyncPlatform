// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85)
namespace AgriSync.BuildingBlocks.Auth.DeviceCheck;

/// <summary>
/// The one-time "is this your account?" question on a new phone (founder D-56). A sign-in on a phone the
/// account has never confirmed gets an access token carrying <see cref="Type"/> = <see cref="Pending"/>;
/// <see cref="DeviceCheckGateMiddleware"/> refuses every authenticated route to such a token with
/// <see cref="UnconfirmedErrorCode"/>, so nothing of the account's farms is served until the person answers
/// "होय" on that phone. The issuer (User.Infrastructure) and the gate share these names, so they cannot drift.
/// </summary>
public static class DeviceCheckClaims
{
    /// <summary>The access-token claim. Absent on every token of a confirmed (known) phone.</summary>
    public const string Type = "device_check";

    /// <summary>The only value it ever has: this phone has not yet answered the question.</summary>
    public const string Pending = "pending";

    /// <summary>The refusal code a held phone gets on every authenticated route (HTTP 403).</summary>
    public const string UnconfirmedErrorCode = "auth.device_unconfirmed";
}
