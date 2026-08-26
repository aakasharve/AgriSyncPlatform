namespace ShramSafal.Application.Contracts.Dtos;

public sealed record CostEntryDto(
    Guid Id,
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    // DATA_PRINCIPLE_SPINE sub-phase 02.5 — renamed from `Category`;
    // value is one of the 13 canonical codes in `ssf.cost_categories`.
    string CategoryId,
    string Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    Guid CreatedByUserId,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    LocationDto? Location,
    bool IsCorrected,
    /// <summary>
    /// Which way the money moved: <c>"Expense"</c>, <c>"Income"</c>, or
    /// <c>null</c> meaning NOBODY EVER SAID.
    /// <para>
    /// The null is load-bearing and must survive to the screen. Every cost
    /// entry written before the column existed carries it, and those rows
    /// include sales — the client sent income down the expense wire, which is
    /// the defect this field closes. A reader that resolves null to "Expense"
    /// to keep a total tidy re-creates the defect one layer up.
    /// </para>
    /// </summary>
    string? Direction = null,
    /// <summary>How much of it. Null = not stated.</summary>
    decimal? Qty = null,
    /// <summary>The farmer's own unit word. Null = not stated.</summary>
    string? Unit = null,
    /// <summary>Price per unit as stated. Null = not stated.</summary>
    decimal? UnitPrice = null,
    /// <summary>Cash / UPI / Bank / Credit. Null = not stated.</summary>
    string? PaymentMode = null,
    /// <summary>Paid to / received from. Null = not stated.</summary>
    string? VendorName = null,
    /// <summary>
    /// Attachment ids the CLIENT stated at capture. <c>null</c> = the producer
    /// made no statement; <c>[]</c> = it said "none linked". Both shapes reach
    /// the client and mean different things.
    /// <para>
    /// NOT the authoritative photo linkage — that is
    /// <c>ssf.attachments.linked_entity_id</c>, which is what the app's
    /// attachment list reads. Named to make the difference impossible to miss.
    /// </para>
    /// </summary>
    IReadOnlyList<string>? ClientAttachmentIds = null);

/// <summary>
/// DATA_PRINCIPLE_SPINE sub-phase 02.5 — reference-data shape for the
/// canonical cost-category lookup. Carries all three display languages
/// so the frontend picks the right one without a second round-trip.
/// </summary>
public sealed record CostCategoryRefDto(
    string Id,
    string DisplayEn,
    string DisplayMr,
    string DisplayHi);
