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

    // spec: trusted-control-room-2026-11-20 (fix wave S-A1, FR-I2, D-159): the control-room door's OWN limits, counted
    // over door codes only. At most one door code per number per DoorMinInterval and at most DoorMaxPerHour per rolling
    // DoorHourWindow; there is deliberately no 24-hour cap, so nobody can lock a person out of the console for a day.

    /// <summary>At most one control-room code per number within this interval (60 seconds).</summary>
    public TimeSpan DoorMinInterval { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>At most this many control-room codes per number per <see cref="DoorHourWindow"/> (10).</summary>
    public int DoorMaxPerHour { get; set; } = 10;

    /// <summary>The rolling window of <see cref="DoorMaxPerHour"/> (one hour).</summary>
    public TimeSpan DoorHourWindow { get; set; } = TimeSpan.FromHours(1);
}
