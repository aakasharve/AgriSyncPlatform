// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A3, H10)
namespace AgriSync.BuildingBlocks.Auth;

/// <summary>Whether the current session began at the control room's own sign-in page (the door).</summary>
public interface IControlRoomSession
{
    bool BeganAtTheDoor { get; }
}
