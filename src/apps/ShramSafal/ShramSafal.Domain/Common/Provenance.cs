namespace ShramSafal.Domain.Common;

/// <summary>
/// Immutable identity record stamped on every AI-derived or AI-assisted row
/// in the ShramSafal schema. Lives on the row as columns (not JSONB) so query
/// planners can index on <c>model_version</c> and <c>prompt_version</c> for
/// A/B comparisons and audit.
///
/// Defined by DATA_PRINCIPLE_SPINE_2026-05-05 Phase 01 (TS01) Sub-phase 01.1.
/// Extended by SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.7 with the
/// <see cref="ExtractorCodeSha"/> field so the git SHA of the extractor code
/// that produced the row is carried in the same owned record as the rest of
/// the lineage (one tuple per row, not a parallel top-level column on each
/// owner). See <c>_COFOUNDER/Projects/AgriSync/Operations/Plans/</c>.
/// </summary>
public sealed record Provenance
{
    /// <summary>Source pipeline that produced the row. One of <see cref="Common.Source.All"/>.</summary>
    public string Source { get; }

    /// <summary>
    /// AI model identifier (e.g. <c>gemini-2.5-flash</c>). For non-AI rows
    /// (<see cref="Common.Source.Manual"/>, <see cref="Common.Source.Import"/>)
    /// the canonical placeholder is <c>"n/a"</c>; never empty.
    /// </summary>
    public string ModelVersion { get; }

    /// <summary>Prompt template version (e.g. <c>v3.2.0</c>). Same <c>"n/a"</c> rule as <see cref="ModelVersion"/>.</summary>
    public string PromptVersion { get; }

    /// <summary>
    /// SHA-256 over the assembled prompt module bytes. Lower-case 64-char hex
    /// when present. <c>null</c> only when the row predates the data spine
    /// (<see cref="Common.Source.PreSpine"/>) or was manually entered without AI.
    /// </summary>
    public string? PromptContentHash { get; }

    /// <summary>Client (or backend) assembly version that wrote the row. <c>null</c> for pre-spine rows.</summary>
    public string? AppVersion { get; }

    /// <summary>
    /// Git SHA of the extractor code that produced the row (full 40-char hex,
    /// short SHAs also accepted). <c>null</c> when unknown — pre-spine rows,
    /// manual writes, and code paths that have not yet been wired to the
    /// build-time <c>SourceRevisionId</c> accessor leave this empty.
    ///
    /// Defined by SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.7 +
    /// ADR-DS-014 §E. Carrying the extractor SHA on every Provenance-owning
    /// row lets downstream replay diff "same prompt + same model + different
    /// extractor code" outcomes — a class of regression the original five
    /// fields could not surface.
    /// </summary>
    public string? ExtractorCodeSha { get; }

    public Provenance(
        string source,
        string modelVersion,
        string promptVersion,
        string? promptContentHash,
        string? appVersion,
        string? extractorCodeSha = null)
    {
        if (string.IsNullOrWhiteSpace(source))
        {
            throw new ArgumentException("source is required", nameof(source));
        }

        if (!Common.Source.All.Contains(source))
        {
            throw new ArgumentException($"unknown source '{source}'", nameof(source));
        }

        if (string.IsNullOrWhiteSpace(modelVersion))
        {
            throw new ArgumentException("modelVersion is required", nameof(modelVersion));
        }

        if (string.IsNullOrWhiteSpace(promptVersion))
        {
            throw new ArgumentException("promptVersion is required", nameof(promptVersion));
        }

        Source = source;
        ModelVersion = modelVersion;
        PromptVersion = promptVersion;
        PromptContentHash = promptContentHash;
        AppVersion = appVersion;
        ExtractorCodeSha = string.IsNullOrWhiteSpace(extractorCodeSha)
            ? null
            : extractorCodeSha.Trim();
    }

    /// <summary>
    /// Synthetic provenance for rows that existed before Phase 01 landed.
    /// Stamped during the backfill migration; downstream corpus queries
    /// deliberately exclude <c>pre_spine</c> rows.
    /// </summary>
    public static Provenance PreSpine() =>
        new(Common.Source.PreSpine, "unknown", "unknown", null, null, extractorCodeSha: null);

    /// <summary>
    /// Convenience factory for manual UI writes. <see cref="ModelVersion"/>
    /// and <see cref="PromptVersion"/> are stamped <c>"n/a"</c>; the caller
    /// supplies the client app version for audit lineage.
    /// </summary>
    public static Provenance Manual(string appVersion) =>
        new(Common.Source.Manual, "n/a", "n/a", null, appVersion, extractorCodeSha: null);
}
