namespace User.Application.Ports;

public sealed record TokenPair(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc);

public interface IJwtTokenService
{
    /// <summary>
    /// Legacy password-login token path. Carries membership claims AND the
    /// <c>phone_verified</c> claim (consumed by /bootstrap/first-farm). Slated
    /// for removal once the web client migrates entirely to OTP.
    /// </summary>
    /// <param name="deviceCheckPending">spec: plr-d10 lane NP-1 — true for a phone that has not yet answered the
    /// new-phone question: the access token then carries <c>device_check = pending</c> and the server's gate serves
    /// it nothing. Required, never defaulted, so every caller decides.</param>
    /// <param name="controlRoomDoor">spec: trusted-control-room-2026-11-20 (plan CR-3, H10) — true only for a session that began
    /// at the control room's own sign-in page (stored under the control room's reserved session platform): the access token
    /// then carries <c>control_room_door = 1</c>. Unlike <paramref name="deviceCheckPending"/> this one IS defaulted, on purpose
    /// (K27): the password and register paths (<c>LoginHandler</c>, <c>RegisterUserHandler</c>) must stay untouched and can
    /// never ask for the mark (P11), so only the three session-carrying handlers name it.</param>
    TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending, bool controlRoomDoor = false);

    /// <summary>
    /// Phase 3 identity-only token per plan §4.2. The JWT carries only
    /// <c>sub</c>, <c>phone_verified</c>, <c>iat</c>, <c>exp</c>, <c>jti</c>
    /// (and <c>device_check = pending</c> while the new-phone question is open, lane NP-1).
    /// No role, no farm id, no account id — those are resolved
    /// server-side per request from <c>FarmMembership</c> +
    /// <c>OwnerAccount</c> reads.
    /// </summary>
    /// <param name="controlRoomDoor">H10 — as on <see cref="GenerateTokens"/>: the door mark, defaulted on purpose (K27).</param>
    TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending, bool controlRoomDoor = false);
}

public sealed record MembershipClaim(string AppId, string Role);
