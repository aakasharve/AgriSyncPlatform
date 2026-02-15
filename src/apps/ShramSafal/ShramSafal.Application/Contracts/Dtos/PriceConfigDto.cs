namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PriceConfigDto(
    Guid Id,
    string ItemName,
    decimal UnitPrice,
    string CurrencyCode,
    DateOnly EffectiveFrom,
    int Version,
    Guid CreatedByUserId,
    DateTime CreatedAtUtc);

