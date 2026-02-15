using AgriSync.BuildingBlocks.Results;

namespace User.Domain.Common;

public static class UserErrors
{
    public static readonly Error PhoneAlreadyRegistered = new("User.PhoneAlreadyRegistered", "A user with this phone number already exists.");
    public static readonly Error InvalidCredentials = new("User.InvalidCredentials", "Phone number or password is incorrect.");
    public static readonly Error UserNotFound = new("User.NotFound", "User not found.");
    public static readonly Error UserDeactivated = new("User.Deactivated", "This account has been deactivated.");
    public static readonly Error InvalidRefreshToken = new("User.InvalidRefreshToken", "Refresh token is invalid or expired.");
    public static readonly Error DuplicateMembership = new("User.DuplicateMembership", "User already has an active membership in this app.");
}
