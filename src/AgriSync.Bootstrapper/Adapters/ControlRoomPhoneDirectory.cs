// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using ShramSafal.Application.Ports;
using User.Application.Ports;

namespace AgriSync.Bootstrapper.Adapters;

/// <summary>
/// Composition-root adapter: the control room (ShramSafal) reads accounts of the User module only through this, because
/// ShramSafal may not reference User. Read-only: it never creates an account and sends nothing.
/// </summary>
public sealed class ControlRoomPhoneDirectory(IUserRepository users) : IControlRoomPhoneDirectory
{
    public async Task<ControlRoomAccount?> FindByPhoneAsync(string tenDigits, CancellationToken ct)
    {
        var user = await users.GetByPhoneAsync(tenDigits, ct);
        return user is null ? null : new ControlRoomAccount(user.Id.Value, user.Phone.Value, user.DisplayName);
    }

    public async Task<ControlRoomAccount?> FindByUserAsync(Guid userId, CancellationToken ct)
    {
        var user = await users.GetByIdAsync(userId, ct);
        return user is null ? null : new ControlRoomAccount(user.Id.Value, user.Phone.Value, user.DisplayName);
    }
}
