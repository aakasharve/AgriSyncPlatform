namespace ShramSafal.Infrastructure.Integrations.Gemini;

public sealed class GeminiOptions
{
    public const string SectionName = "Gemini";

    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = "gemini-2.0-flash";
    public decimal Temperature { get; set; } = 0.2m;
    public int MaxTokens { get; set; } = 4096;
}
