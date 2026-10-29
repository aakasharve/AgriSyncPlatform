namespace User.Application.UseCases.Auth.RegisterUser;

/// <summary>
/// spec I19 (pre-launch repair, D-23) — the one switch for password self-registration
/// (<c>POST /user/auth/register</c>). Bound from configuration section <c>Auth</c>:
/// <c>Auth:AllowPasswordRegistration</c> (env: <c>Auth__AllowPasswordRegistration</c>).
///
/// <para>Default OFF in every environment and set in no appsettings file. Turn it on only for a
/// throwaway test stack that needs it. Even when on, a password-registered account is NOT
/// phone-verified (only an SMS code verifies a number) and never gets a chosen role.</para>
/// </summary>
public sealed class PasswordRegistrationOptions
{
    public const string SectionName = "Auth";

    public bool AllowPasswordRegistration { get; set; }
}
