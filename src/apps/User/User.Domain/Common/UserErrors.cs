using AgriSync.BuildingBlocks.Results;

namespace User.Domain.Common;

/// <summary>
/// Canonical static <see cref="Error"/> instances surfaced by User
/// application handlers. Tagged with <see cref="ErrorKind"/> per the
/// Sub-plan 03 Task 2 audit so endpoint adapters map them to the
/// canonical RFC 7807 status codes.
/// </summary>
public static class UserErrors
{
    public static readonly Error PhoneAlreadyRegistered =
        Error.Conflict("User.PhoneAlreadyRegistered", "A user with this phone number already exists.");

    /// <summary>
    /// Auth credential mismatch — modeled as <see cref="ErrorKind.Unauthenticated"/>
    /// so it maps to HTTP 401 (caller is anonymous to us, not "forbidden from
    /// an identified resource").
    /// </summary>
    public static readonly Error InvalidCredentials =
        Error.Unauthenticated("User.InvalidCredentials", "Phone number or password is incorrect.");

    public static readonly Error UserNotFound =
        Error.NotFound("User.NotFound", "User not found.");

    /// <summary>
    /// Account exists but cannot act — <see cref="ErrorKind.Forbidden"/> (HTTP 403).
    /// </summary>
    public static readonly Error UserDeactivated =
        Error.Forbidden("User.Deactivated", "This account has been deactivated.");

    public static readonly Error InvalidRefreshToken =
        Error.Unauthenticated("User.InvalidRefreshToken", "Refresh token is invalid or expired.");

    public static readonly Error DuplicateMembership =
        Error.Conflict("User.DuplicateMembership", "User already has an active membership in this app.");

    /// <summary>
    /// spec I19 (pre-launch repair, D-23) — password sign-up is closed unless the test-only
    /// setting <c>Auth:AllowPasswordRegistration</c> is on. Sign-up is by SMS code
    /// (<c>/user/auth/start-otp</c> → <c>/verify-otp</c>). HTTP 403.
    /// </summary>
    public static readonly Error PasswordRegistrationClosed =
        Error.Forbidden("auth.password_registration_closed", "Password sign-up is closed. Sign up with the SMS code sent to your phone.");

    /// <summary>
    /// spec I19 — the caller may never choose an account role at sign-up (that role used to be
    /// read by test, compliance and schedule-template checks on every farm). HTTP 400.
    /// </summary>
    public static readonly Error RegisterRoleNotAllowed =
        Error.Validation("auth.register_role_not_allowed", "An account role cannot be chosen at sign-up.");

    /// <summary>
    /// spec: plr-d10 lane NP-1 — "नाही" from a phone that is not being asked the new-phone question (it is known,
    /// or already answered). Refused, so a known phone can never end up carrying a "number changed hands" mark. HTTP 409.
    /// </summary>
    public static readonly Error DeviceCheckNotAsked =
        Error.Conflict("auth.device_check_not_asked", "This phone is not being asked whether the account is yours.");
}
