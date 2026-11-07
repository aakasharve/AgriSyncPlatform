using User.Application.Ports;
using User.Domain.Security;

namespace User.Application.UseCases.Auth.Session;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56). The ONE definition of a "new
/// phone" for an account, used by every sign-in: a phone is <b>known</b> when this account has a session row on its
/// device id (the per-install id the phone sends at sign-in and on every request) that is not held for the question —
/// it answered "होय" there, it is the phone that made the account, or it was signed in before this question existed
/// (rows the migration found have no hold). Every other phone is <b>new</b> and is asked once:
/// "हे खातं ‹नाव› यांचं आहे — तुम्ही तेच आहात का?".
///
/// <para>The server's placeholder ids are never a phone: <c>unknown</c> (no id was sent) and <c>legacy</c> (rows from
/// before device sessions) can be typed by anyone, so a row carrying one never makes a phone known.</para>
/// </summary>
public static class NewPhoneQuestion
{
    private static readonly HashSet<string> Placeholders = new(StringComparer.OrdinalIgnoreCase) { "unknown", "legacy" };

    /// <summary>True when the id names a real phone install (not blank, not a placeholder).</summary>
    public static bool NamesAPhone(string? deviceId) =>
        !string.IsNullOrWhiteSpace(deviceId) && !Placeholders.Contains(deviceId.Trim());

    /// <summary>Is this phone already known for this account?</summary>
    public static async Task<bool> IsKnownAsync(
        IRefreshTokenRepository sessions, Guid userId, string deviceId, CancellationToken ct) =>
        NamesAPhone(deviceId) && await sessions.HasUnheldSessionOnDeviceAsync(userId, deviceId, ct);

    /// <summary>
    /// The hold for an SMS sign-in on an EXISTING account: none on a known phone, asked on any other (including one
    /// that sent no id — the SMS path is exactly the one a new holder of the number can take).
    /// </summary>
    public static async Task<DeviceCheckState?> HoldForSmsSignInAsync(
        IRefreshTokenRepository sessions, Guid userId, string deviceId, CancellationToken ct) =>
        await IsKnownAsync(sessions, userId, deviceId, ct) ? null : DeviceCheckState.AskedAfterSmsCode;

    /// <summary>
    /// The hold for the test-only password sign-in: asked on a new phone, exactly like SMS, so the phone shows the same
    /// screens. A sign-in that names no phone (the admin console) is not held: the password itself is the proof there,
    /// which a new holder of the number does not have.
    /// </summary>
    public static async Task<DeviceCheckState?> HoldForPasswordSignInAsync(
        IRefreshTokenRepository sessions, Guid userId, string deviceId, CancellationToken ct)
    {
        if (!NamesAPhone(deviceId))
        {
            return null;
        }

        return await sessions.HasUnheldSessionOnDeviceAsync(userId, deviceId, ct) ? null : DeviceCheckState.AskedAfterPassword;
    }
}
