namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Canonical result of an <see cref="ShramSafal.Application.Ports.External.IOcrProvider"/>
/// extraction call. OCR is a single-step operation — the provider takes an
/// image + a system prompt + an operation discriminator and returns
/// normalized JSON. No separate transcribe/structure split because raster
/// OCR is not usefully decomposed at this layer.
///
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.9 (Safeguard S1).
/// </summary>
public sealed record OcrResult
{
    /// <summary>True when the provider returned valid normalized JSON.</summary>
    public bool Success { get; init; }

    /// <summary>
    /// Normalized JSON conforming to the active OCR extraction schema
    /// (Receipt or Patti, selected by <c>OcrOperation</c>).
    /// </summary>
    public string? NormalizedJson { get; init; }

    /// <summary>Wire-level model version the provider returned.</summary>
    public string? ProviderModelVersion { get; init; }

    /// <summary>Confidence in the extracted JSON, clamped to [0,1].</summary>
    public decimal OverallConfidence { get; init; }

    /// <summary>
    /// Provider-supplied error message when <see cref="Success"/> is false.
    /// </summary>
    public string? Error { get; init; }
}
