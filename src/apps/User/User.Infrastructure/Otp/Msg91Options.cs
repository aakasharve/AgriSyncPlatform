namespace User.Infrastructure.Otp;

/// <summary>
/// MSG91 OTP v5 configuration.
///
/// Binding source: <c>appsettings.*.json</c> section <c>Msg91</c>.
/// Secrets (<see cref="AuthKey"/>) MUST come from dotnet user-secrets or
/// environment variables, never from committed files.
///
/// Dev-mode fallback: if <see cref="UseDevStub"/> is true, no MSG91 call
/// is made — OTPs are written to logs instead.
/// </summary>
public sealed class Msg91Options
{
    public const string SectionName = "Msg91";

    /// <summary>Development toggle: when true, <c>Msg91SmsSender</c> is replaced by the dev stub.</summary>
    public bool UseDevStub { get; set; } = true;

    /// <summary>MSG91 auth key — dashboard → Settings → API keys.</summary>
    public string AuthKey { get; set; } = string.Empty;

    /// <summary>DLT-registered template id (from MSG91 dashboard after DLT approval).</summary>
    public string TemplateId { get; set; } = string.Empty;

    /// <summary>Optional sender id (6-char DLT-approved header). Defaults to the template's bound sender.</summary>
    public string? SenderId { get; set; }

    /// <summary>OTP length. Matches plan §5.2 — defaults to 6 digits.</summary>
    public int OtpLength { get; set; } = 6;

    /// <summary>OTP TTL in minutes. MSG91 caps at 1440 (24h); plan §5.2 uses 5.</summary>
    public int OtpExpiryMinutes { get; set; } = 5;

    /// <summary>Max verify attempts per challenge. Plan §5.2 = 5.</summary>
    public int MaxVerifyAttempts { get; set; } = 5;

    /// <summary>Per-phone rate limits — plan §5.2.</summary>
    public int MaxShortWindowRequests { get; set; } = 3;
    public TimeSpan ShortWindow { get; set; } = TimeSpan.FromMinutes(15);
    public int MaxLongWindowRequests { get; set; } = 6;
    public TimeSpan LongWindow { get; set; } = TimeSpan.FromHours(24);

    public string BaseUrl { get; set; } = "https://control.msg91.com/api/v5";
}
