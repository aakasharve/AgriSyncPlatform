namespace User.Application.UseCases.Auth.TestLogin;

/// <summary>
/// SARVAM_DEPLOY_READINESS gate B6 enabler (2026-05-28) —
/// founder real-diary hand-test bypass for OTP login.
///
/// <para>
/// <b>What this is.</b> A tightly-scoped configuration switch that
/// opens a parallel auth surface (<c>POST /user/auth/test-login</c>)
/// allowing the founder to log in as an explicitly allowlisted
/// pre-seeded test user without an SMS round-trip. Required to clear
/// gate B6 because production has no SMS provider configured for the
/// founder's test devices and synthetic OTPs would weaken the real
/// OTP path for actual farmers.
/// </para>
///
/// <para>
/// <b>What this is NOT.</b> Not a way to bypass OTP for arbitrary
/// users. Not a way to create new users. Not a way to escalate roles.
/// Not a way to skip rate limits on the real OTP path. The real OTP
/// flow (<c>StartOtpHandler</c> + <c>VerifyOtpHandler</c>) is
/// completely untouched.
/// </para>
///
/// <para>
/// <b>Default posture.</b> Both fields default to "no bypass":
/// <see cref="Enabled"/> defaults to <c>false</c> and
/// <see cref="AllowedPhoneNumbersE164"/> defaults to an empty list.
/// Production <c>appsettings.Production.json</c> sets
/// <c>TestLogin.Enabled = false</c> explicitly so an env-var override
/// at deploy time is the only surface that could turn it on.
/// </para>
///
/// <para>
/// <b>Two-gate check on every call.</b> Even when
/// <see cref="Enabled"/> is <c>true</c>, the handler also verifies the
/// requested phone number is in <see cref="AllowedPhoneNumbersE164"/>.
/// An empty allowlist with the flag on means "flag is on but no users
/// can use it" — still safe, just useless. Both sides must align for
/// any login to succeed.
/// </para>
///
/// <para>
/// <b>Endpoint gating.</b> When <see cref="Enabled"/> is <c>false</c>,
/// <c>POST /user/auth/test-login</c> is NEVER REGISTERED at startup —
/// requests return HTTP 404, not 401/403, so discovery probes can't
/// even tell the surface existed. See
/// <c>AuthEndpoints.MapAuthEndpoints</c>.
/// </para>
/// </summary>
public sealed class TestLoginOptions
{
    public const string SectionName = "TestLogin";

    /// <summary>
    /// Master switch. <c>false</c> by default. When <c>false</c>:
    /// the endpoint is not registered, the handler is not resolvable
    /// via DI, and any code path reaching this options instance
    /// behaves as if the feature does not exist.
    /// </summary>
    public bool Enabled { get; set; } = false;

    /// <summary>
    /// Allowlist of normalized phone numbers (10-digit Indian form,
    /// matching <c>PhoneNumber.Create</c>'s output — country-code
    /// stripped) permitted to use the test-login surface. An empty
    /// list with <see cref="Enabled"/> = <c>true</c> means "no user
    /// can pass": both sides of the gate must align.
    /// </summary>
    public IList<string> AllowedPhoneNumbersE164 { get; set; } = new List<string>();
}
