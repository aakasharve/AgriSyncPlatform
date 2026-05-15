namespace ShramSafal.Domain.AI;

public sealed record VoiceParseCanonicalResult
{
    public bool Success { get; init; }
    public string? ModelUsed { get; init; }
    public string? PromptVersion { get; init; }

    /// <summary>
    /// Full 64-char SHA-256 of the assembled voice-parsing prompt. Populated
    /// by the orchestrator from <see cref="ShramSafal.Application.Ports.External.IAiPromptBuilder.CurrentVoicePromptContentHash"/>
    /// on both the success and cached-result paths. Threaded onto downstream
    /// <c>Provenance</c> stamps per DATA_PRINCIPLE_SPINE sub-phase 01.4.
    /// </summary>
    public string? PromptContentHash { get; init; }

    public string? NormalizedJson { get; init; }
    public string? RawTranscript { get; init; }
    public decimal OverallConfidence { get; init; }
    public List<string> Warnings { get; init; } = [];
    public string? Error { get; init; }
}
