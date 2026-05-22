using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Single-role port for the "transcript → structured JSON" step.
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.9 (Safeguard S1). Decoupled from
/// <see cref="ITranscriberProvider"/> so the orchestrator can compose
/// pipelines like "Sarvam-transcribe → Gemini-structure" without either
/// adapter knowing about the other half of the operation.
/// </summary>
public interface IStructurerProvider
{
    /// <summary>Provider identity for fallback + audit routing.</summary>
    AiProviderType ProviderType { get; }

    /// <summary>
    /// Blocking structure. Takes a transcript (or any free text) and a system
    /// prompt, returns normalized JSON. Implementations MUST stamp
    /// <see cref="StructureResult.PromptVersion"/> and
    /// <see cref="StructureResult.PromptContentHash"/> from the assembled
    /// prompt so Provenance stays consistent across the orchestrator boundary.
    /// </summary>
    Task<StructureResult> StructureAsync(
        string transcript,
        string systemPrompt,
        CancellationToken ct);

    /// <summary>
    /// Streaming structure. Yields incremental JSON fragments. Providers
    /// without native streaming throw <see cref="NotSupportedException"/>
    /// (the orchestrator falls back to <see cref="StructureAsync"/>).
    /// </summary>
    IAsyncEnumerable<string> StructureStreamAsync(
        string transcript,
        string systemPrompt,
        CancellationToken ct);
}
