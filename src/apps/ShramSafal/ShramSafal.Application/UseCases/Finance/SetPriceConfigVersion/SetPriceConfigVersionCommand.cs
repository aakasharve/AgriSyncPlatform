namespace ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;

public sealed record SetPriceConfigVersionCommand(
    string ItemName,
    decimal UnitPrice,
    string CurrencyCode,
    DateOnly EffectiveFrom,
    int Version,
    Guid CreatedByUserId,
    Guid? PriceConfigId = null);
