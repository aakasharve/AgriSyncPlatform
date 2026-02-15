using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Finance;

public sealed class FinanceCorrection : Entity<Guid>
{
    private FinanceCorrection() : base(Guid.Empty) { } // EF Core

    private FinanceCorrection(
        Guid id,
        Guid costEntryId,
        decimal originalAmount,
        decimal correctedAmount,
        string currencyCode,
        string reason,
        UserId correctedByUserId,
        DateTime correctedAtUtc)
        : base(id)
    {
        CostEntryId = costEntryId;
        OriginalAmount = originalAmount;
        CorrectedAmount = correctedAmount;
        CurrencyCode = currencyCode;
        Reason = reason;
        CorrectedByUserId = correctedByUserId;
        CorrectedAtUtc = correctedAtUtc;
    }

    public Guid CostEntryId { get; private set; }
    public decimal OriginalAmount { get; private set; }
    public decimal CorrectedAmount { get; private set; }
    public string CurrencyCode { get; private set; } = "INR";
    public string Reason { get; private set; } = string.Empty;
    public UserId CorrectedByUserId { get; private set; }
    public DateTime CorrectedAtUtc { get; private set; }

    public static FinanceCorrection Create(
        Guid id,
        Guid costEntryId,
        decimal originalAmount,
        decimal correctedAmount,
        string currencyCode,
        string reason,
        UserId correctedByUserId,
        DateTime correctedAtUtc)
    {
        if (correctedAmount <= 0)
        {
            throw new ArgumentException("Corrected amount must be greater than zero.", nameof(correctedAmount));
        }

        if (string.IsNullOrWhiteSpace(currencyCode))
        {
            throw new ArgumentException("Currency code is required.", nameof(currencyCode));
        }

        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Correction reason is required.", nameof(reason));
        }

        return new FinanceCorrection(
            id,
            costEntryId,
            decimal.Round(originalAmount, 2, MidpointRounding.AwayFromZero),
            decimal.Round(correctedAmount, 2, MidpointRounding.AwayFromZero),
            currencyCode.Trim().ToUpperInvariant(),
            reason.Trim(),
            correctedByUserId,
            correctedAtUtc);
    }
}
