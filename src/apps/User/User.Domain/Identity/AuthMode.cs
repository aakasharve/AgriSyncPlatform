namespace User.Domain.Identity;

/// <summary>
/// How a user authenticates by default.
/// <see cref="Password"/> — classic phone + password.
/// <see cref="Otp"/>      — phone + OTP; password is an unusable marker.
/// Semantics are consumed by the frontend so the password box never
/// appears for OTP users.
/// </summary>
public enum AuthMode
{
    Password = 0,
    Otp = 1,
}
