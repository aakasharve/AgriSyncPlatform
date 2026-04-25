namespace ShramSafal.Domain.AI;

public sealed record VoiceParseCanonicalResult
{
    public bool Success { get; init; }
    public string? ModelUsed { get; init; }
    public string? PromptVersion { get; init; }
    public string? NormalizedJson { get; init; }
    public string? RawTranscript { get; init; }
    public decimal OverallConfidence { get; init; }
    public List<string> Warnings { get; init; } = [];
    public string? Error { get; init; }
}
