namespace User.Application.UseCases.Auth.TestLogin;

/// <summary>
/// SARVAM_DEPLOY_READINESS gate B6 enabler. Single field: the phone
/// number to log in as. The handler resolves the existing User via
/// repository (test-login NEVER auto-creates users) and issues a JWT
/// with the same claim shape as <c>VerifyOtpHandler</c>.
/// </summary>
public sealed record TestLoginCommand(string Phone);
