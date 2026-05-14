namespace ShramSafal.Domain.Common;

/// <summary>
/// Immutable five-field identity record stamped on every AI-derived or
/// AI-assisted row in the ShramSafal schema. Lives on the row as columns
/// (not JSONB) so query planners can index on <c>model_version</c> and
/// <c>prompt_version</c> for A/B comparisons and audit.
///
/// Defined by DATA_PRINCIPLE_SPINE_2026-05-05 Phase 01 (TS01) Sub-phase 01.1.
/// See <c>_COFOUNDER/Projects/AgriSync/Operations/Plans/DATA_PRINCIPLE_SPINE_2026-05-05/</c>
/// for the principles this record serves (P1, P8, P9).
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

    public Provenance(
        string source,
        string modelVersion,
        string promptVersion,
        string? promptContentHash,
        string? appVersion)
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
    }

    /// <summary>
    /// Synthetic provenance for rows that existed before Phase 01 landed.
    /// Stamped during the backfill migration; downstream corpus queries
    /// deliberately exclude <c>pre_spine</c> rows.
    /// </summary>
    public static Provenance PreSpine() =>
        new(Common.Source.PreSpine, "unknown", "unknown", null, null);

    /// <summary>
    /// Convenience factory for manual UI writes. <see cref="ModelVersion"/>
    /// and <see cref="PromptVersion"/> are stamped <c>"n/a"</c>; the caller
    /// supplies the client app version for audit lineage.
    /// </summary>
    public static Provenance Manual(string appVersion) =>
        new(Common.Source.Manual, "n/a", "n/a", null, appVersion);
}
