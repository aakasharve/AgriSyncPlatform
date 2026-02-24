namespace ShramSafal.Infrastructure.Integrations.Sarvam;

public sealed class SarvamOptions
{
    public const string SectionName = "Sarvam";

    public string ApiSubscriptionKey { get; set; } = string.Empty;
    public string SttEndpoint { get; set; } = "https://api.sarvam.ai/speech-to-text";
    public string SttModel { get; set; } = "saaras:v3";
    public string SttMode { get; set; } = "transcribe";
    public string SttLanguage { get; set; } = "unknown";
    public string ChatEndpoint { get; set; } = "https://api.sarvam.ai/v1/chat/completions";
    public string ChatModel { get; set; } = "sarvam-m";
    public string VisionModel { get; set; } = "sarvam-vision";
    public decimal ChatTemperature { get; set; } = 0.2m;
    public int TimeoutSeconds { get; set; } = 45;
    public int DocIntelTimeoutSeconds { get; set; } = 120;
}
