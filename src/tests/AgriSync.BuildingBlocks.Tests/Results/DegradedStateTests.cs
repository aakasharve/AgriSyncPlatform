using AgriSync.BuildingBlocks.Results;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Results;

/// <summary>
/// Sub-plan 03 Task 10: <see cref="DegradedState{T}"/> envelope.
/// </summary>
public sealed class DegradedStateTests
{
    [Fact]
    public void Healthy_factory_yields_no_degraded_components()
    {
        var state = DegradedState<string>.Healthy("ok");
        Assert.Equal("ok", state.PartialValue);
        Assert.Empty(state.Degraded);
        Assert.False(state.IsDegraded);
    }

    [Fact]
    public void Constructed_with_degraded_components_reports_IsDegraded_true()
    {
        var degraded = new[]
        {
            new DegradedComponent("CompA", "CompA.Down", "x"),
            new DegradedComponent("CompB", "CompB.Slow", "y"),
        };
        var state = new DegradedState<int>(0, degraded);
        Assert.Equal(0, state.PartialValue);
        Assert.Equal(2, state.Degraded.Count);
        Assert.True(state.IsDegraded);
    }
}
