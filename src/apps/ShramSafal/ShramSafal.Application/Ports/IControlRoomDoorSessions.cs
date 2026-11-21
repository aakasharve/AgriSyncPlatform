// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-A4, AU-M1)
namespace ShramSafal.Application.Ports;

/// <summary>
/// The control room's console sessions, which live in the User module (ShramSafal may not reference it): the host
/// implements this over the session registry. Only sessions that began at the console door (the reserved session
/// platform) are ever touched; an account's farmer-app sessions never are.
/// </summary>
public interface IControlRoomDoorSessions
{
    /// <summary>
    /// Ends (revokes) every console session of <paramref name="userId"/> that is still open, at <paramref name="utcNow"/>,
    /// so none of them can be refreshed again, even if the person is added back later. Returns how many were ended.
    /// </summary>
    Task<int> EndDoorSessionsAsync(Guid userId, DateTime utcNow, CancellationToken ct);
}

/// <summary>
/// Registered by the ShramSafal module only as a fallback (TryAdd): the host replaces it with the real adapter. Called,
/// it throws, so a host that forgot the adapter fails the removal loudly (500) instead of silently leaving the person's
/// console sessions open.
/// </summary>
public sealed class ControlRoomDoorSessionsNotWired : IControlRoomDoorSessions
{
    public Task<int> EndDoorSessionsAsync(Guid userId, DateTime utcNow, CancellationToken ct) =>
        throw new InvalidOperationException(
            "No control-room session adapter is registered; the host must register IControlRoomDoorSessions.");
}
