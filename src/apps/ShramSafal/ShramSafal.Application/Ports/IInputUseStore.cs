// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slices B and C)
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.Ports;

/// <summary>
/// One product of one CURRENT application record, exactly as the record holds it (what he said), for the derivation to read and the
/// season ledger to show. A separate port, not part of <see cref="IShramSafalRepository"/>, so the ledger and the derived-use rows touch
/// nothing else in the save path.
/// </summary>
public sealed record UsedInput(
    Guid FarmId,
    Guid? PlotId,
    string? PlotName,
    Guid OperationId,
    Guid? SourceDailyLogId,
    Guid CreatedByUserId,
    DateOnly UseDate,
    Guid ItemId,
    int Ordinal,
    string ProductName,
    string? ProductType,
    string? NpkGrade,
    decimal? DoseAmount,
    string? DoseUnit,
    decimal? DoseBasisQty,
    string? DoseBasisUnit,
    string? DoseCertainty,
    string? DoseSpokenText,
    string? Method,
    decimal? CarrierWaterLitres);

/// <summary>A used product with what the server worked out about it (null where it could not be worked out), for the ledger.</summary>
public sealed record InputUseLedgerRow(UsedInput Used, InputUseFact? Facts, IReadOnlyList<InputUseIngredient> Ingredients);

public interface IInputUseStore
{
    /// <summary>The current-version application records of a farm, one entry per product: one saved record's, or a date range's, or all.</summary>
    Task<IReadOnlyList<UsedInput>> ReadCurrentUsesAsync(
        Guid farmId, Guid? sourceDailyLogId, DateOnly? from, DateOnly? to, CancellationToken ct = default);

    /// <summary>Replaces the derived rows of these input items with these (a re-derivation never leaves two), and saves.</summary>
    Task ReplaceAsync(
        Guid farmId, IReadOnlyCollection<Guid> inputItemIds,
        IReadOnlyList<InputUseFact> facts, IReadOnlyList<InputUseIngredient> ingredients, CancellationToken ct = default);

    /// <summary>The ledger: every current use in the range with its derived rows (none where it has not been derived), oldest first.</summary>
    Task<IReadOnlyList<InputUseLedgerRow>> ReadLedgerAsync(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default);
}
