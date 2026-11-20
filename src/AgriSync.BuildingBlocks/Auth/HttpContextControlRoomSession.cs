// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A3, H10)
using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Auth;

/// <summary>
/// True only for an authenticated principal carrying exactly <see cref="ControlRoomSessionClaims.Type"/> =
/// <see cref="ControlRoomSessionClaims.Value"/>. With no request (a background job) the answer is false, so a job never passes.
/// </summary>
public sealed class HttpContextControlRoomSession(IHttpContextAccessor accessor) : IControlRoomSession
{
    public bool BeganAtTheDoor
    {
        get
        {
            var user = accessor.HttpContext?.User;
            if (user?.Identity?.IsAuthenticated != true) return false;

            var marks = user.Claims.Where(c => c.Type == ControlRoomSessionClaims.Type).ToList();
            return marks.Count > 0 && marks.All(c => c.Value == ControlRoomSessionClaims.Value);
        }
    }
}
