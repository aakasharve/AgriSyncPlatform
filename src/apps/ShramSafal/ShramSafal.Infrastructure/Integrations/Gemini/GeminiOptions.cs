namespace ShramSafal.Infrastructure.Integrations.Gemini;

public sealed class GeminiOptions
{
    public const string SectionName = "Gemini";
    public const string DefaultStructurerModelId = "gemini-3.1-flash-lite-preview";
    public const string DefaultOcrModelId = "gemini-2.5-flash";
    public const string DefaultVoiceFallbackModelId = "gemini-2.5-flash";
    public const string DefaultModelId = DefaultVoiceFallbackModelId;

    public string ApiKey { get; set; } = string.Empty;
    public string StructurerModelId { get; set; } = DefaultStructurerModelId;
    public string OcrModelId { get; set; } = DefaultOcrModelId;
    public string VoiceFallbackModelId { get; set; } = DefaultVoiceFallbackModelId;
    public decimal Temperature { get; set; } = 0.2m;
    public int MaxTokens { get; set; } = 4096;
    public int TimeoutSeconds { get; set; } = 30;
    public string BaseUrl { get; set; } = "https://generativelanguage.googleapis.com/v1beta";

    [Obsolete("Use StructurerModelId, OcrModelId, or VoiceFallbackModelId per operation.")]
    public string? ModelId { get; set; }

    [Obsolete("Use StructurerModelId, OcrModelId, or VoiceFallbackModelId per operation.")]
    public string? Model
    {
        get => ModelId;
        set => ModelId = value;
    }
}
