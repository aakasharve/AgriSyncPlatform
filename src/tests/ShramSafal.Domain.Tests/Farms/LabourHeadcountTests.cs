using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class LabourHeadcountTests
{
    [Fact]
    public void Resolve_count_only_returns_count()
    {
        var result = LabourHeadcount.Resolve(workerCount: 5, maleCount: null, femaleCount: null);
        Assert.Equal(5, result);
    }

    [Fact]
    public void Resolve_split_only_returns_sum()
    {
        var result = LabourHeadcount.Resolve(workerCount: null, maleCount: 3, femaleCount: 2);
        Assert.Equal(5, result);
    }

    [Fact]
    public void Resolve_both_set_count_wins()
    {
        var result = LabourHeadcount.Resolve(workerCount: 5, maleCount: 3, femaleCount: 2);
        Assert.Equal(5, result);
    }

    [Fact]
    public void Resolve_count_zero_falls_through_to_split()
    {
        var result = LabourHeadcount.Resolve(workerCount: 0, maleCount: 2, femaleCount: 3);
        Assert.Equal(5, result);
    }

    [Fact]
    public void Resolve_all_null_returns_zero()
    {
        var result = LabourHeadcount.Resolve(workerCount: null, maleCount: null, femaleCount: null);
        Assert.Equal(0, result);
    }
}
