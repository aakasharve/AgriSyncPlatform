namespace ShramSafal.Domain.Finance;

public sealed class DayLedgerAllocation
{
    private DayLedgerAllocation() { } // EF Core

    private DayLedgerAllocation(
        Guid id,
        Guid plotId,
        decimal allocatedAmount,
        string currencyCode,
        DateTime allocatedAtUtc)
    {
        Id = id;
        PlotId = plotId;
        AllocatedAmount = allocatedAmount;
        CurrencyCode = currencyCode;
        AllocatedAtUtc = allocatedAtUtc;
    }

    public Guid Id { get; private set; }
    public Guid PlotId { get; private set; }
    public decimal AllocatedAmount { get; private set; }
    public string CurrencyCode { get; private set; } = "INR";
    public DateTime AllocatedAtUtc { get; private set; }

    public static DayLedgerAllocation Create(
        Guid id,
        Guid plotId,
        decimal allocatedAmount,
        string currencyCode,
        DateTime allocatedAtUtc)
    {
        if (plotId == Guid.Empty)
        {
            throw new ArgumentException("Plot id is required.", nameof(plotId));
        }

        if (allocatedAmount <= 0)
        {
            throw new ArgumentException("Allocated amount must be greater than zero.", nameof(allocatedAmount));
        }

        if (string.IsNullOrWhiteSpace(currencyCode))
        {
            throw new ArgumentException("Currency code is required.", nameof(currencyCode));
        }

        return new DayLedgerAllocation(
            id,
            plotId,
            decimal.Round(allocatedAmount, 2, MidpointRounding.AwayFromZero),
            currencyCode.Trim().ToUpperInvariant(),
            allocatedAtUtc);
    }
}
