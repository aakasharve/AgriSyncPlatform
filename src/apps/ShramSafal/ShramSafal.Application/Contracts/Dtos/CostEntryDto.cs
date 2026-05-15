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
    bool IsCorrected);

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
