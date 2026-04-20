using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Finance;

public sealed class PriceConfig : Entity<Guid>
{
    private PriceConfig() : base(Guid.Empty) { } // EF Core

    private PriceConfig(
        Guid id,
        string itemName,
        decimal unitPrice,
        string currencyCode,
        DateOnly effectiveFrom,
        int version,
        UserId createdByUserId,
        DateTime createdAtUtc)
        : base(id)
    {
        ItemName = itemName;
        UnitPrice = unitPrice;
        CurrencyCode = currencyCode;
        EffectiveFrom = effectiveFrom;
        Version = version;
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public string ItemName { get; private set; } = string.Empty;
    public decimal UnitPrice { get; private set; }
    public string CurrencyCode { get; private set; } = "INR";
    public DateOnly EffectiveFrom { get; private set; }
    public int Version { get; private set; }
    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    public static PriceConfig Create(
        Guid id,
        string itemName,
        decimal unitPrice,
        string currencyCode,
        DateOnly effectiveFrom,
        int version,
        UserId createdByUserId,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(itemName))
        {
            throw new ArgumentException("Item name is required.", nameof(itemName));
        }

        if (unitPrice < 0)
        {
            throw new ArgumentException("Unit price cannot be negative.", nameof(unitPrice));
        }

        if (version <= 0)
        {
            throw new ArgumentException("Version must be greater than zero.", nameof(version));
        }

        if (string.IsNullOrWhiteSpace(currencyCode))
        {
            throw new ArgumentException("Currency code is required.", nameof(currencyCode));
        }

        return new PriceConfig(
            id,
            itemName.Trim(),
            decimal.Round(unitPrice, 2, MidpointRounding.AwayFromZero),
            currencyCode.Trim().ToUpperInvariant(),
            effectiveFrom,
            version,
            createdByUserId,
            createdAtUtc);
    }
}
