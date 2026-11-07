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
    bool CreatedNewUser,
    DateTime RefreshExpiresAtUtc,
    // spec: plr-d10 lane NP-1 — see AuthResponse: the question is open on this phone, and the name it shows.
    bool DeviceCheckRequired = false,
    string? AccountName = null);
