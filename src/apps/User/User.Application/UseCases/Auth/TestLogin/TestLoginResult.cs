using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Application.UseCases.Auth.TestLogin;

/// <summary>
/// Mirrors <c>VerifyOtpResult</c>'s shape so the frontend's existing
/// post-login flow (token storage, refresh-token registration, etc.)
/// can consume the response without a special case. The single
/// behavior difference vs OTP: <c>CreatedNewUser</c> is always
/// <c>false</c> — test-login NEVER creates users.
/// </summary>
public sealed record TestLoginResult(
    UserId UserId,
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresAtUtc);
