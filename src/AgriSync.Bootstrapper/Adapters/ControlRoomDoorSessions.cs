// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-A4, AU-M1)
using AgriSync.BuildingBlocks.Auth;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using User.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Adapters;

/// <summary>
/// Composition-root adapter: ends a person's console sessions in the User module's session registry
/// (<c>public.refresh_tokens</c>) when the founder removes them. Only rows stored under the reserved console-door
/// platform are revoked (it only compares the platform; it never builds a session); farmer-app sessions are untouched.
/// </summary>
public sealed class ControlRoomDoorSessions(UserDbContext users) : IControlRoomDoorSessions
{
    /// <summary>The revocation reason stored on each ended row.</summary>
    public const string RevocationReason = "control_room_person_removed";

    public async Task<int> EndDoorSessionsAsync(Guid userId, DateTime utcNow, CancellationToken ct)
    {
        var account = new UserId(userId);
        var open = await users.RefreshTokens
            .Where(t => t.UserId == account
                && t.Platform == ControlRoomSessionClaims.SessionPlatform
                && t.RevokedAtUtc == null)
            .ToListAsync(ct);
        if (open.Count == 0)
        {
            return 0;
        }

        foreach (var session in open)
        {
            session.Revoke(utcNow, RevocationReason);
        }

        await users.SaveChangesAsync(ct);
        return open.Count;
    }
}
