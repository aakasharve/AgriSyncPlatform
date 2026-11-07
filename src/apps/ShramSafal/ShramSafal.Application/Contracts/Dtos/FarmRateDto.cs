using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// spec: plr-d10 lane RATE-1 part A (founder D-72) — one VERSION of one rate of a farm's own list, on the pull
/// (<c>farmRates</c>, additive and last) and the REST doors. Enum NAMES on the wire (<c>Input</c> / <c>Work</c>;
/// <c>PerUnit</c> … <c>PerTask</c>), never ordinals. The newest version of a <see cref="RateLineId"/> is current; a
/// <see cref="Retired"/> version is the rate stopped. The author is a user id only.
/// </summary>
public sealed record FarmRateDto(
    Guid Id,
    Guid RateLineId,
    Guid FarmId,
    int Version,
    string Kind,
    string ItemName,
    string? Unit,
    string Basis,
    string? WorkerCategory,
    decimal Amount,
    string CurrencyCode,
    DateOnly EffectiveFrom,
    string? Season,
    DateOnly? EndsOn,
    bool Retired,
    Guid? SuggestionId,
    Guid CreatedByUserId,
    DateTime CreatedAtUtc)
{
    public static FarmRateDto From(FarmRate rate) =>
        new(
            rate.Id,
            rate.RateLineId,
            (Guid)rate.FarmId,
            rate.Version,
            rate.Kind.ToString(),
            rate.ItemName,
            rate.Unit,
            rate.Basis.ToString(),
            rate.WorkerCategory,
            rate.Amount,
            rate.CurrencyCode,
            rate.EffectiveFrom,
            rate.Season,
            rate.EndsOn,
            rate.Retired,
            rate.SuggestionId,
            rate.CreatedByUserId.Value,
            rate.CreatedAtUtc);
}

/// <summary>
/// lane RATE-1 — the REST read of one farm's list as THIS reader may see it: whether he may set rates (the one gate the
/// write obeys, so the phone shows or hides its controls by it), whether he reads input prices and work rates (a kind he
/// does not read is shown as a ShramSafal rule and "—", never ₹ 0), and every version he may read.
/// </summary>
public sealed record FarmRatesDto(
    Guid FarmId,
    bool MayWrite,
    bool SeeInputPrices,
    bool SeeWorkRates,
    IReadOnlyList<FarmRateDto> Rates);

/// <summary>
/// lane RATE-1 — one ShramSafal suggested rate: the newest version of one item of the admin's shared list (D-72: admin
/// only). It states an item and an amount only — no unit, no kind, no farm — so confirming it prefills only those two.
/// </summary>
public sealed record RateSuggestionDto(Guid Id, string ItemName, decimal UnitPrice, string CurrencyCode, DateOnly EffectiveFrom);

/// <summary>lane RATE-1 — the suggestion door's answer.</summary>
public sealed record RateSuggestionsDto(IReadOnlyList<RateSuggestionDto> Suggestions);
