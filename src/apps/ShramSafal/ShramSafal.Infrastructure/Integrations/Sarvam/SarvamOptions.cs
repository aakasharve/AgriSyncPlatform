namespace ShramSafal.Infrastructure.Integrations.Sarvam;

public sealed class SarvamOptions
{
    public const string SectionName = "Sarvam";

    public string ApiSubscriptionKey { get; set; } = string.Empty;
    public string SttEndpoint { get; set; } = "https://api.sarvam.ai/speech-to-text";
    public string SttModel { get; set; } = "saaras:v3";
    public string SttMode { get; set; } = "codemix";
    public string SttLanguage { get; set; } = "mr-IN";
    public string StreamingSttEndpoint { get; set; } = "wss://api.sarvam.ai/speech-to-text/ws";
    public string StreamingSttModel { get; set; } = "saaras:v3";
    public string StreamingSttMode { get; set; } = "codemix";
    public string StreamingSttLanguage { get; set; } = "mr-IN";
    public int StreamingSampleRate { get; set; } = 16000;
    public string StreamingInputAudioCodec { get; set; } = "wav";
    public bool StreamingHighVadSensitivity { get; set; } = true;
    public bool StreamingVadSignals { get; set; } = true;
    public bool StreamingFlushSignal { get; set; } = true;
    public int StreamingTimeoutSeconds { get; set; } = 30;
    public string ChatEndpoint { get; set; } = "https://api.sarvam.ai/v1/chat/completions";
    public string ChatModel { get; set; } = "sarvam-m";
    public string VisionModel { get; set; } = "sarvam-vision";
    public decimal ChatTemperature { get; set; } = 0.2m;
    public int TimeoutSeconds { get; set; } = 45;
    public string DocIntelEndpoint { get; set; } = "https://api.sarvam.ai/doc-digitization/job/v1";
    public int DocIntelTimeoutSeconds { get; set; } = 120;
}
