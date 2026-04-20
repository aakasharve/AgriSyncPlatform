namespace User.Application.UseCases.Auth.StartOtp;

public sealed record StartOtpCommand(string Phone);

public sealed record StartOtpResult(
    string PhoneNumberNormalized,
    DateTime ExpiresAtUtc,
    int ResendAfterSeconds,
    string ProviderName);
