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
}
