using System.Reflection;
using System.Text.RegularExpressions;
using AgriSync.BuildingBlocks.Analytics;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Analytics;

public sealed class AnalyticsEventTypeTests
{
    private static readonly Regex EventTypePattern = new("^[a-z0-9_]+(?:\\.[a-z0-9_]+)+$", RegexOptions.Compiled);

    [Fact]
    public void AllConstants_FollowDottedLowerSnakeConvention()
    {
        var constants = typeof(AnalyticsEventType)
            .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
            .Where(f => f is { IsLiteral: true, IsInitOnly: false } && f.FieldType == typeof(string))
            .Select(f => (Name: f.Name, Value: (string)f.GetRawConstantValue()!))
            .ToArray();

        Assert.NotEmpty(constants);

        foreach (var (name, value) in constants)
        {
            Assert.True(
                EventTypePattern.IsMatch(value),
                $"AnalyticsEventType.{name} = '{value}' must match {EventTypePattern}.");
        }
    }

    [Fact]
    public void AllConstants_AreUnique()
    {
        var values = typeof(AnalyticsEventType)
            .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
            .Where(f => f is { IsLiteral: true, IsInitOnly: false } && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToArray();

        Assert.Equal(values.Length, values.Distinct().Count());
    }
}
