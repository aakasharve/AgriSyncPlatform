namespace ShramSafal.Infrastructure.Integrations.Gemini;

public sealed class GeminiOptions
{
    public const string SectionName = "Gemini";
    public const string DefaultModelId = "gemini-2.5-flash";

    public string ApiKey { get; set; } = string.Empty;
    public string ModelId { get; set; } = DefaultModelId;
    public decimal Temperature { get; set; } = 0.2m;
    public int MaxTokens { get; set; } = 4096;
    public int TimeoutSeconds { get; set; } = 30;
    public string BaseUrl { get; set; } = "https://generativelanguage.googleapis.com/v1beta";

    // Backward compatibility with earlier configuration key.
    public string Model
    {
        get => ModelId;
        set => ModelId = value;
    }
}
