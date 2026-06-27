using User.Application.UseCases.Auth.Session;

namespace User.Application.UseCases.Auth.VerifyOtp;

public sealed record VerifyOtpCommand(
    string Phone,
    string Otp,
    string? DisplayName,
    DeviceSessionRequest Session);

public sealed record VerifyOtpResult(
    Guid UserId,
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresAtUtc,
    bool CreatedNewUser);
