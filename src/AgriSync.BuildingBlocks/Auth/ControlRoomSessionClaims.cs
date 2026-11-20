// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A3, H10)
namespace AgriSync.BuildingBlocks.Auth;

/// <summary>
/// The mark of a control-room sign-in. A session that began at the console's own sign-in page (the door) holds an
/// access token carrying <see cref="Type"/> = <see cref="Value"/>; a phone sign-in never does. The issuer (User) and the
/// resolver (ShramSafal) share these names, as <c>DeviceCheckClaims</c> does, so they cannot drift.
/// </summary>
public static class ControlRoomSessionClaims
{
    /// <summary>The access-token claim. Absent on every phone token.</summary>
    public const string Type = "control_room_door";

    /// <summary>The only value it ever has.</summary>
    public const string Value = "1";

    /// <summary>The platform name a door session is recorded under.</summary>
    public const string SessionPlatform = "control-room-door";

    /// <summary>The refusal code (HTTP 401) a team seat gets when its session did not begin at the door.</summary>
    public const string RequiredErrorCode = "control_room.door_session_required";
}
