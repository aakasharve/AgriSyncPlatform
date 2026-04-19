namespace User.Application.UseCases.Auth;

/// <summary>
/// Application-layer OTP policy (plan §5.2). Infrastructure-level
/// MSG91 config (auth key, template id, base URL) stays in
/// <c>User.Infrastructure.Otp.Msg91Options</c>; handlers read from
/// this simpler shape so Application has zero dependency on the
/// specific SMS provider.
/// </summary>
public sealed class OtpPolicyOptions
{
    public const string SectionName = "OtpPolicy";

    public int OtpLength { get; set; } = 6;
    public int OtpExpiryMinutes { get; set; } = 5;
    public int MaxVerifyAttempts { get; set; } = 5;

    public int MaxShortWindowRequests { get; set; } = 3;
    public TimeSpan ShortWindow { get; set; } = TimeSpan.FromMinutes(15);
    public int MaxLongWindowRequests { get; set; } = 6;
    public TimeSpan LongWindow { get; set; } = TimeSpan.FromHours(24);
}
