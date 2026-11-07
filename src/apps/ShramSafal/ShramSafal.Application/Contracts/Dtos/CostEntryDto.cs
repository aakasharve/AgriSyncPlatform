using System.Text.Json.Serialization;

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
    IReadOnlyList<string>? ClientAttachmentIds = null,
    /// <summary>
    /// spec: plr-d10 lane PRV (founder D-26) — who may see this money record (<c>Team</c> / <c>Selected</c> /
    /// <c>OnlyMe</c>), sent ONLY to the farm's primary account holder; <c>null</c> for everyone else. Additive (P11).
    /// </summary>
    string? Audience = null,
    /// <summary>lane PRV — the people the holder chose (<c>Selected</c>); sent only with <see cref="Audience"/>.</summary>
    IReadOnlyList<Guid>? AudienceUserIds = null,
    /// <summary>
    /// spec: plr-d10 lane BILL-1 (founder D-12) — which version of the bill this is (1 as first saved, one more for every
    /// correction or move). The version a reviewer's मंजूर names. Sent by the pull and the approve door only; every other
    /// answer leaves it out (never a key, so their bytes are unchanged: P11).
    /// </summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? BillVersion = null,
    /// <summary>
    /// lane BILL-1 — "तपासायचे": the server set the bill aside and no stamp covers its current version. NOT named
    /// <c>isFlagged</c> on purpose: 1.0.17 reads that name and would show an Approve button that can only fail (OF-M N2).
    /// </summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    bool? NeedsReview = null,
    /// <summary>lane BILL-1 — why it was set aside (the server's English words; the phone says them in its language).</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ReviewReason = null,
    /// <summary>lane BILL-1 — the latest मंजूर stamp (who, when, which version); absent when nobody approved it.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    CostEntryApprovalDto? Approval = null,
    /// <summary>
    /// spec: plr-d10 lane BILL-1b (founder D-105 (b), 2026-11-08) — when the farm's primary account holder (the main owner)
    /// changed this bill's price AFTER it was approved: the moment of his latest such change. Once a bill is approved only he can
    /// change its price, and the bill then shows "मालकाने बदलला" / "Changed by owner" to everyone, him included. Absent when
    /// no such change happened; sent by the pull and the approve door only (never a key elsewhere, so their bytes are
    /// unchanged: P11). The stamps stay: an older phone shows the old stamp and ignores this key.
    /// </summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    DateTime? ChangedByOwnerAtUtc = null);

/// <summary>
/// spec: plr-d10 lane BILL-1 (founder D-12: "a separate "मंजूर" stamp with who and when") — one reviewer's मंजूर on a bill.
/// <see cref="BillVersion"/> below the bill's own <see cref="CostEntryDto.BillVersion"/> means the stamp is for an older
/// version: the bill was corrected after it was approved, and the stamp is never carried to the new numbers.
/// <see cref="ApprovedByName"/> follows MU-3's naming rule (an own-records seat is sent no other person's name): null then.
/// </summary>
public sealed record CostEntryApprovalDto(
    Guid Id,
    Guid ApprovedByUserId,
    string? ApprovedByName,
    DateTime ApprovedAtUtc,
    int BillVersion);

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
