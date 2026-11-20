// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6, H10)
using AgriSync.BuildingBlocks.Auth;

namespace User.Application.UseCases.Auth.Session;

/// <summary>
/// The platform name a farmer sign-in route may store for a session, from what the client sent. Blank is
/// <c>unknown</c>, as before. The control room's reserved name (<see cref="ControlRoomSessionClaims.SessionPlatform"/>),
/// in any case and with any spaces around it, is also <c>unknown</c>: a session stored under that name is issued with the
/// door mark on every refresh, so no client of the <c>/user/auth</c> routes may ever ask for it. Only the console's own
/// door builds a session with the reserved name, and it never takes the name from the client.
/// </summary>
public static class DeviceSessionPlatform
{
    public const string Unknown = "unknown";

    public static string FromClient(string? platform)
    {
        if (string.IsNullOrWhiteSpace(platform))
        {
            return Unknown;
        }

        var trimmed = platform.Trim();
        return string.Equals(trimmed, ControlRoomSessionClaims.SessionPlatform, StringComparison.OrdinalIgnoreCase)
            ? Unknown
            : trimmed;
    }
}
