// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
namespace ShramSafal.Application.Ports;

/// <summary>An account in the User module, as the People page needs it. <see cref="TenDigitPhone"/> is the stored form (no country code).</summary>
public sealed record ControlRoomAccount(Guid UserId, string TenDigitPhone, string DisplayName);

/// <summary>
/// The one way the control room reads the User module (it may not reference it): the account behind a number, and the
/// account behind a user id. Read-only; it never creates an account and never sends anything.
/// </summary>
public interface IControlRoomPhoneDirectory
{
    Task<ControlRoomAccount?> FindByPhoneAsync(string tenDigits, CancellationToken ct);

    Task<ControlRoomAccount?> FindByUserAsync(Guid userId, CancellationToken ct);
}
