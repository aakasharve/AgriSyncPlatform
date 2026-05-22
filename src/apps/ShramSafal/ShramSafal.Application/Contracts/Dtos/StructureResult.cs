namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Canonical result of an <see cref="ShramSafal.Application.Ports.External.IStructurerProvider"/>
/// structuring call. Takes a transcript (or any free text) and a system
/// prompt, returns normalized JSON that matches the active extraction schema.
/// Separated from <see cref="TranscribeResult"/> per Safeguard S1
/// (SARVAM_PRIMARY_VOICE_PIPELINE Task 1.9) so a single provider can
/// participate in either role without dragging the other's surface area.
/// </summary>
public sealed record StructureResult
{
    /// <summary>True when the provider returned valid normalized JSON.</summary>
    public bool Success { get; init; }

    /// <summary>
    /// Normalized JSON conforming to the active extraction schema. The
    /// orchestrator parses + validates this against the Zod-equivalent
    /// server-side schema before writing to the AiJob.
    /// </summary>
    public string? NormalizedJson { get; init; }

    /// <summary>
    /// Wire-level model version the provider returned (e.g. <c>sarvam-m</c>,
    /// <c>gemini-2.0-flash</c>). Stamped onto Provenance.ModelVersion.
    /// </summary>
    public string? ProviderModelVersion { get; init; }

    /// <summary>
    /// Prompt template version the provider was invoked with (e.g. <c>v3.2.0</c>).
    /// Echoed from <see cref="ShramSafal.Application.Ports.External.IAiPromptBuilder.CurrentVoicePromptVersion"/>
    /// so Provenance stays consistent across the orchestrator + adapter boundary.
    /// </summary>
    public string? PromptVersion { get; init; }

    /// <summary>
    /// SHA-256 of the assembled prompt module bytes. Lower-case 64-char hex.
    /// Threaded onto Provenance.PromptContentHash.
    /// </summary>
    public string? PromptContentHash { get; init; }

    /// <summary>
    /// Overall confidence in the structured result, clamped to [0,1]. Used by
    /// the orchestrator to decide whether to fall back to a sibling provider.
    /// </summary>
    public decimal OverallConfidence { get; init; }

    /// <summary>
    /// Provider-supplied error message when <see cref="Success"/> is false.
    /// </summary>
    public string? Error { get; init; }
}
