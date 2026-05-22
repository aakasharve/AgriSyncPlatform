using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Operation discriminator for <see cref="IOcrProvider"/>. Raster OCR has two
/// callable shapes today — receipts (Phase 2 Y.md §3) and patti (Phase 2.5).
/// Routing lives in the port rather than the provider so adapters that only
/// support one shape can decline the other at compile time.
///
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.9 (Safeguard S1).
/// </summary>
public enum OcrOperation
{
    /// <summary>Receipt / invoice OCR for cost-entry capture.</summary>
    Receipt,

    /// <summary>Patti (sale slip) OCR for revenue capture.</summary>
    Patti,
}

/// <summary>
/// Single-role port for raster OCR. SARVAM_PRIMARY_VOICE_PIPELINE Task 1.9.
/// OCR is intentionally a single-step contract (no separate
/// transcribe/structure split) because the provider produces normalized JSON
/// directly from the image.
/// </summary>
public interface IOcrProvider
{
    /// <summary>Provider identity for fallback + audit routing.</summary>
    AiProviderType ProviderType { get; }

    /// <summary>
    /// Extract structured JSON from an image. The <paramref name="operation"/>
    /// discriminator selects the active schema (receipt vs patti) so the
    /// provider can pick the right system prompt + post-validation rules.
    /// </summary>
    Task<OcrResult> ExtractAsync(
        Stream image,
        string mimeType,
        string systemPrompt,
        OcrOperation operation,
        CancellationToken ct);
}
