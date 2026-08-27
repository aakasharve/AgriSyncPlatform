using AgriSync.BuildingBlocks.Domain;
using ShramSafal.Domain.Common;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed CHILD of <see cref="FarmOperation"/> (ADR 0023 §1) — one row per
/// input mix item (product + NPK grade + split dose). EXISTS-join child: it carries
/// only the parent FK (<see cref="OperationId"/>), no own farm_id, no Provenance, no
/// version chain (children are replaced wholesale on parent supersession, ADR §1.2).
/// </summary>
public sealed class ApplicationInputItem : Entity<Guid>
{
    private ApplicationInputItem() : base(Guid.Empty) { } // EF Core

    private ApplicationInputItem(
        Guid id, Guid operationId, string productName, string? productType, string? npkGrade,
        decimal? doseAmount, string? doseUnit, decimal? doseBasisQty, string? doseBasisUnit,
        int ordinal, DateTime createdAtUtc,
        NumericCertainty? doseCertainty, string? doseSpokenText)
        : base(id)
    {
        OperationId = operationId;
        ProductName = productName;
        ProductType = productType;
        NpkGrade = npkGrade;
        DoseAmount = doseAmount;
        DoseUnit = doseUnit;
        DoseBasisQty = doseBasisQty;
        DoseBasisUnit = doseBasisUnit;
        Ordinal = ordinal;
        CreatedAtUtc = createdAtUtc;
        DoseCertainty = doseCertainty;
        DoseSpokenText = doseSpokenText;
    }

    public Guid OperationId { get; private set; }
    public string ProductName { get; private set; } = string.Empty;
    public string? ProductType { get; private set; }   // e.g. fertilizer/fungicide/growth_regulator
    public string? NpkGrade { get; private set; }       // e.g. 00:52:34, 19:19:19, 13:00:45
    public decimal? DoseAmount { get; private set; }    // split dose (§3.2a): {amount, unit, basisQty, basisUnit}
    public string? DoseUnit { get; private set; }
    public decimal? DoseBasisQty { get; private set; }
    public string? DoseBasisUnit { get; private set; }
    public int Ordinal { get; private set; }            // position within the operation's mix
    public DateTime CreatedAtUtc { get; private set; }

    // ── wave-3.12, spec Ruling 5 — how sure the farmer was of THIS dose ──
    /// <summary>NULL when he was never asked. Never defaulted to Reported (P4).</summary>
    public NumericCertainty? DoseCertainty { get; private set; }

    /// <summary>His own words for the dose ("अंदाजे ५०० मिली"), kept verbatim beside it.</summary>
    public string? DoseSpokenText { get; private set; }

    public static ApplicationInputItem Create(
        Guid id, Guid operationId, string productName, string? productType, string? npkGrade,
        decimal? doseAmount, string? doseUnit, decimal? doseBasisQty, string? doseBasisUnit,
        int ordinal, DateTime createdAtUtc,
        // wave-3.12 — trailing and OPTIONAL so every pre-existing call site keeps
        // compiling and keeps writing NULL, which is exactly "not asked, not stated".
        NumericCertainty? doseCertainty = null, string? doseSpokenText = null)
    {
        if (string.IsNullOrWhiteSpace(productName))
            throw new ArgumentException("productName must be non-blank.", nameof(productName));

        return new ApplicationInputItem(
            id, operationId, productName.Trim(), productType, npkGrade,
            doseAmount, doseUnit, doseBasisQty, doseBasisUnit, ordinal, createdAtUtc,
            doseCertainty, doseSpokenText);
    }
}
