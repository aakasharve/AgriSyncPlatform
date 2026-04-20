namespace ShramSafal.Domain.Finance;

public sealed class PlotAllocation
{
    private PlotAllocation() { } // EF Core

    private PlotAllocation(
        Guid plotId,
        Guid cropCycleId,
        decimal allocationPercent,
        decimal allocatedAmount)
    {
        PlotId = plotId;
        CropCycleId = cropCycleId;
        AllocationPercent = allocationPercent;
        AllocatedAmount = allocatedAmount;
    }

    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }
    public decimal AllocationPercent { get; private set; }
    public decimal AllocatedAmount { get; private set; }

    public static PlotAllocation Create(
        Guid plotId,
        Guid cropCycleId,
        decimal allocationPercent,
        decimal allocatedAmount)
    {
        if (plotId == Guid.Empty)
        {
            throw new ArgumentException("Plot id is required.", nameof(plotId));
        }

        if (allocationPercent < 0)
        {
            throw new ArgumentException("Allocation percent cannot be negative.", nameof(allocationPercent));
        }

        if (allocatedAmount < 0)
        {
            throw new ArgumentException("Allocated amount cannot be negative.", nameof(allocatedAmount));
        }

        return new PlotAllocation(
            plotId,
            cropCycleId,
            decimal.Round(allocationPercent, 2, MidpointRounding.AwayFromZero),
            decimal.Round(allocatedAmount, 2, MidpointRounding.AwayFromZero));
    }

    public PlotAllocation WithCropCycleId(Guid cropCycleId)
    {
        CropCycleId = cropCycleId;
        return this;
    }
}
