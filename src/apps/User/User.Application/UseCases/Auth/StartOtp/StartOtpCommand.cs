using User.Domain.Security;

namespace User.Application.UseCases.Auth.StartOtp;

/// <param name="Phone">The number as typed.</param>
/// <param name="Purpose">spec: trusted-control-room-2026-11-20 (fix wave S-A1): the door the code is for. The farmer
/// route never names one (the farmer app); only the control room's background code sender names
/// <see cref="OtpPurpose.ControlRoomDoor"/>.</param>
public sealed record StartOtpCommand(string Phone, OtpPurpose Purpose = OtpPurpose.FarmerApp);

public sealed record StartOtpResult(
    string PhoneNumberNormalized,
    DateTime ExpiresAtUtc,
    int ResendAfterSeconds,
    string ProviderName);
