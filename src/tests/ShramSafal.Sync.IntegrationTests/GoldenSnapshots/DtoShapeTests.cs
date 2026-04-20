using System;
using System.IO;
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.GoldenSnapshots;

[Trait("Suite", "CEI_Baseline")]
public sealed class DtoShapeTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static string GoldenPath(string file) =>
        Path.Combine(AppContext.BaseDirectory, "GoldenSnapshots", file);

    [Fact]
    public void PlannedActivityDto_preserves_pre_ceiupgrade_shape()
    {
        var goldenJson = File.ReadAllText(GoldenPath("PlannedActivityDto_before.json"));
        var roundTripped = JsonSerializer.Deserialize<PlannedActivityDto>(goldenJson, JsonOptions)!;

        roundTripped.Id.Should().NotBe(Guid.Empty);
        roundTripped.CropCycleId.Should().NotBe(Guid.Empty);
        roundTripped.ActivityName.Should().NotBeNullOrEmpty();
        roundTripped.Stage.Should().NotBeNullOrEmpty();
        roundTripped.PlannedDate.Should().NotBe(default);
        roundTripped.CreatedAtUtc.Should().NotBe(default);
        roundTripped.ModifiedAtUtc.Should().NotBe(default);
    }

    [Fact]
    public void LogTaskDto_preserves_pre_ceiupgrade_shape()
    {
        var goldenJson = File.ReadAllText(GoldenPath("LogTaskDto_before.json"));
        var roundTripped = JsonSerializer.Deserialize<LogTaskDto>(goldenJson, JsonOptions)!;

        roundTripped.Id.Should().NotBe(Guid.Empty);
        roundTripped.ActivityType.Should().NotBeNullOrEmpty();
        roundTripped.OccurredAtUtc.Should().NotBe(default);
    }

    [Fact]
    public void ScheduleTemplateDto_preserves_pre_ceiupgrade_shape()
    {
        var goldenJson = File.ReadAllText(GoldenPath("ScheduleTemplateDto_before.json"));
        var roundTripped = JsonSerializer.Deserialize<ScheduleTemplateDto>(goldenJson, JsonOptions)!;

        roundTripped.Id.Should().NotBe(Guid.Empty);
        roundTripped.Name.Should().NotBeNullOrEmpty();
        roundTripped.CropType.Should().NotBeNullOrEmpty();
        roundTripped.TotalDays.Should().BeGreaterThan(0);
        roundTripped.Stages.Should().NotBeEmpty();
        roundTripped.Activities.Should().NotBeEmpty();
        roundTripped.VersionHash.Should().NotBeNullOrEmpty();
    }
}
