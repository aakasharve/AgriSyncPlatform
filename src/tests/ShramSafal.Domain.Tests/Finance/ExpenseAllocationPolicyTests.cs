using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

public sealed class ExpenseAllocationPolicyTests
{
    [Fact]
    public void EqualAllocation_ThreePlots_ThreeHundred_IsHundredEach()
    {
        var p1 = Guid.NewGuid();
        var p2 = Guid.NewGuid();
        var p3 = Guid.NewGuid();

        var allocations = ExpenseAllocationPolicy.CalculateAllocations(
            [(p1, 2m), (p2, 3m), (p3, 2m)],
            300m,
            AllocationStrategy.Equal,
            null);

        Assert.Equal(3, allocations.Count);
        Assert.Equal(100m, allocations.Single(a => a.PlotId == p1).AllocatedAmount);
        Assert.Equal(100m, allocations.Single(a => a.PlotId == p2).AllocatedAmount);
        Assert.Equal(100m, allocations.Single(a => a.PlotId == p3).AllocatedAmount);
        Assert.Equal(300m, allocations.Sum(a => a.AllocatedAmount));
    }

    [Fact]
    public void ByAcreageAllocation_2_3_2_Acres_SevenHundred_IsProportional()
    {
        var p1 = Guid.NewGuid();
        var p2 = Guid.NewGuid();
        var p3 = Guid.NewGuid();

        var allocations = ExpenseAllocationPolicy.CalculateAllocations(
            [(p1, 2m), (p2, 3m), (p3, 2m)],
            700m,
            AllocationStrategy.ByAcreage,
            null);

        Assert.Equal(3, allocations.Count);
        Assert.Equal(200m, allocations.Single(a => a.PlotId == p1).AllocatedAmount);
        Assert.Equal(300m, allocations.Single(a => a.PlotId == p2).AllocatedAmount);
        Assert.Equal(200m, allocations.Single(a => a.PlotId == p3).AllocatedAmount);
        Assert.Equal(700m, allocations.Sum(a => a.AllocatedAmount));
    }

    [Fact]
    public void CustomAllocation_ExplicitPercentages_AppliesConfiguredSplit()
    {
        var p1 = Guid.NewGuid();
        var p2 = Guid.NewGuid();
        var p3 = Guid.NewGuid();

        var allocations = ExpenseAllocationPolicy.CalculateAllocations(
            [(p1, 2m), (p2, 3m), (p3, 2m)],
            1000m,
            AllocationStrategy.Custom,
            new Dictionary<Guid, decimal>
            {
                [p1] = 50m,
                [p2] = 30m,
                [p3] = 20m
            });

        Assert.Equal(500m, allocations.Single(a => a.PlotId == p1).AllocatedAmount);
        Assert.Equal(300m, allocations.Single(a => a.PlotId == p2).AllocatedAmount);
        Assert.Equal(200m, allocations.Single(a => a.PlotId == p3).AllocatedAmount);
        Assert.Equal(1000m, allocations.Sum(a => a.AllocatedAmount));
    }

    [Fact]
    public void SinglePlot_GetsHundredPercent()
    {
        var plotId = Guid.NewGuid();

        var allocations = ExpenseAllocationPolicy.CalculateAllocations(
            [(plotId, 2m)],
            450m,
            AllocationStrategy.Equal,
            null);

        Assert.Single(allocations);
        Assert.Equal(100m, allocations[0].AllocationPercent);
        Assert.Equal(450m, allocations[0].AllocatedAmount);
    }

    [Fact]
    public void EqualAllocation_Rounding_AdjustsLastPlotToExactTotal()
    {
        var p1 = Guid.NewGuid();
        var p2 = Guid.NewGuid();
        var p3 = Guid.NewGuid();

        var allocations = ExpenseAllocationPolicy.CalculateAllocations(
            [(p1, 1m), (p2, 1m), (p3, 1m)],
            100m,
            AllocationStrategy.Equal,
            null);

        Assert.Equal(33.33m, allocations.Single(a => a.PlotId == p1).AllocatedAmount);
        Assert.Equal(33.33m, allocations.Single(a => a.PlotId == p2).AllocatedAmount);
        Assert.Equal(33.34m, allocations.Single(a => a.PlotId == p3).AllocatedAmount);
        Assert.Equal(100m, allocations.Sum(a => a.AllocatedAmount));
    }

    [Fact]
    public void ZeroPlots_ReturnsEmptyList()
    {
        var allocations = ExpenseAllocationPolicy.CalculateAllocations(
            [],
            100m,
            AllocationStrategy.Equal,
            null);

        Assert.Empty(allocations);
    }
}
