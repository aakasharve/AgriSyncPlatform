namespace ShramSafal.Domain.Common;

/// <summary>
/// Canonical provenance source values for any AI- or human-authored row that
/// participates in the Data Spine. Every <see cref="Provenance"/> instance
/// carries one of these as its <c>Source</c>. New values land here first
/// (and only here); free-text source strings are rejected by the
/// <see cref="Provenance"/> constructor.
///
/// Defined by DATA_PRINCIPLE_SPINE_2026-05-05 Phase 01 (TS01) Sub-phase 01.1.
/// </summary>
public static class Source
{
    /// <summary>AI-parsed from a voice note.</summary>
    public const string Voice = "voice";

    /// <summary>Manually entered through the UI without AI assistance.</summary>
    public const string Manual = "manual";

    /// <summary>AI-parsed from a receipt image (OCR pipeline).</summary>
    public const string ReceiptOcr = "receipt_ocr";

    /// <summary>AI-parsed from a patti (labour ledger) image.</summary>
    public const string PattiOcr = "patti_ocr";

    /// <summary>Bulk-imported via seed or migration tooling.</summary>
    public const string Import = "import";

    /// <summary>
    /// Row predates the Data Spine and was backfilled with a synthetic source
    /// during the Phase 01 migration. Audit and corpus queries deliberately
    /// exclude <c>pre_spine</c> rows.
    /// </summary>
    public const string PreSpine = "pre_spine";

    /// <summary>
    /// Frozen set of every legal source value. The <see cref="Provenance"/>
    /// constructor uses this for validation; downstream tooling can iterate
    /// it to surface filters or audit category lists.
    /// </summary>
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        Voice,
        Manual,
        ReceiptOcr,
        PattiOcr,
        Import,
        PreSpine,
    };
}
