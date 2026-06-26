using System;
using System.Linq;
using AgriSync.BuildingBlocks.Analytics;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Analytics;

/// <summary>
/// Unit tests for the analytics partition planner. These pin the partition
/// NAMING and RANGE math to the contract baked into the initial migration
/// (<c>20260419054331_AnalyticsInitial.cs</c>) so the maintenance job can never
/// drift from the migration-created partitions.
/// </summary>
public sealed class AnalyticsPartitionPlanTests
{
    [Fact]
    public void ForHorizon_returns_monthsAhead_plus_one_specs()
    {
        var specs = AnalyticsPartitionPlan.ForHorizon(new DateOnly(2026, 6, 15), 3);

        Assert.Equal(4, specs.Count);
    }

    [Fact]
    public void ForHorizon_first_spec_is_the_current_month()
    {
        var specs = AnalyticsPartitionPlan.ForHorizon(new DateOnly(2026, 6, 15), 3);

        Assert.Equal("events_p_2026_06", specs[0].TableName);
        Assert.Equal(new DateOnly(2026, 6, 1), specs[0].FromInclusive);
        Assert.Equal(new DateOnly(2026, 7, 1), specs[0].ToExclusive);
    }

    [Fact]
    public void ForHorizon_name_matches_migration_format_with_zero_padded_month()
    {
        // Migration uses to_char(start, '"events_p_"YYYY_MM') => zero-padded month.
        var specs = AnalyticsPartitionPlan.ForHorizon(new DateOnly(2026, 1, 9), 0);

        Assert.Equal("events_p_2026_01", specs[0].TableName);
        Assert.Equal("analytics.events_p_2026_01", specs[0].QualifiedName);
    }

    [Fact]
    public void ForHorizon_crosses_year_boundary_correctly()
    {
        var specs = AnalyticsPartitionPlan.ForHorizon(new DateOnly(2026, 11, 20), 3);

        Assert.Equal(
            new[] { "events_p_2026_11", "events_p_2026_12", "events_p_2027_01", "events_p_2027_02" },
            specs.Select(s => s.TableName).ToArray());
    }

    [Fact]
    public void ForHorizon_ranges_are_contiguous_and_half_open()
    {
        var specs = AnalyticsPartitionPlan.ForHorizon(new DateOnly(2026, 11, 20), 3);

        for (var i = 1; i < specs.Count; i++)
        {
            // Each partition's lower bound is the previous partition's upper bound.
            Assert.Equal(specs[i - 1].ToExclusive, specs[i].FromInclusive);
        }
    }

    [Fact]
    public void ForHorizon_horizon_zero_returns_only_current_month()
    {
        var specs = AnalyticsPartitionPlan.ForHorizon(new DateOnly(2026, 6, 15), 0);

        Assert.Single(specs);
        Assert.Equal("events_p_2026_06", specs[0].TableName);
    }

    [Fact]
    public void ForHorizon_negative_horizon_throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => AnalyticsPartitionPlan.ForHorizon(new DateOnly(2026, 6, 15), -1));
    }
}
