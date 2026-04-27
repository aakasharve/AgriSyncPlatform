namespace ShramSafal.Infrastructure.Integrations.Weather;

public sealed class TomorrowIoOptions
{
    public const string SectionName = "Weather:TomorrowIo";

    public string ApiKey { get; set; } = string.Empty;
    public string BaseUrl { get; set; } = "https://api.tomorrow.io/v4";
    public int TimeoutSeconds { get; set; } = 15;
}
