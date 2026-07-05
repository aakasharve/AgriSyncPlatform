using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class RoutinePatternTests
{
    private static readonly Guid Farm = Guid.Parse("99999999-9999-9999-9999-999999999999");

    [Fact]
    public void Create_sets_all_fields()
    {
        var id = Guid.NewGuid();
        var plot = Guid.NewGuid();
        var created = new DateTime(2025, 10, 1, 6, 0, 0, DateTimeKind.Utc);
        var updated = new DateTime(2025, 10, 19, 6, 0, 0, DateTimeKind.Utc);

        var pattern = RoutinePattern.Create(
            id, Farm,
            plotId: plot,
            operationType: "irrigation",
            typicalDurationHours: 4.0m,
            typicalMethod: "drip",
            typicalSource: "motor",
            sampleCount: 5,
            createdAtUtc: created,
            updatedAtUtc: updated);

        Assert.Equal(id, pattern.Id);
        Assert.Equal(Farm, pattern.FarmId);
        Assert.Equal(plot, pattern.PlotId);
        Assert.Equal("irrigation", pattern.OperationType);
        Assert.Equal(4.0m, pattern.TypicalDurationHours);
        Assert.Equal("drip", pattern.TypicalMethod);
        Assert.Equal("motor", pattern.TypicalSource);
        Assert.Equal(5, pattern.SampleCount);
        Assert.Equal(created, pattern.CreatedAtUtc);
        Assert.Equal(updated, pattern.UpdatedAtUtc);
    }

    [Fact]
    public void Create_accepts_null_optionals()
    {
        var ts = new DateTime(2025, 11, 1, 9, 0, 0, DateTimeKind.Utc);

        var pattern = RoutinePattern.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            operationType: "spray",
            typicalDurationHours: null,
            typicalMethod: null,
            typicalSource: null,
            sampleCount: 1,
            createdAtUtc: ts,
            updatedAtUtc: ts);

        Assert.Null(pattern.PlotId);
        Assert.Null(pattern.TypicalDurationHours);
        Assert.Null(pattern.TypicalMethod);
        Assert.Null(pattern.TypicalSource);
        Assert.Equal(Farm, pattern.FarmId);                  // tenancy key always present
        Assert.Equal("spray", pattern.OperationType);
        Assert.Equal(1, pattern.SampleCount);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_throws_on_blank_operationType(string blank)
    {
        Assert.Throws<ArgumentException>(() => RoutinePattern.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            operationType: blank,
            typicalDurationHours: null,
            typicalMethod: null,
            typicalSource: null,
            sampleCount: 1,
            createdAtUtc: DateTime.UtcNow,
            updatedAtUtc: DateTime.UtcNow));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Create_throws_on_nonpositive_sampleCount(int sampleCount)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => RoutinePattern.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            operationType: "irrigation",
            typicalDurationHours: null,
            typicalMethod: null,
            typicalSource: null,
            sampleCount: sampleCount,
            createdAtUtc: DateTime.UtcNow,
            updatedAtUtc: DateTime.UtcNow));
    }

    [Fact]
    public void Create_trims_operationType()
    {
        var pattern = RoutinePattern.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            operationType: "  irrigation  ",
            typicalDurationHours: null,
            typicalMethod: null,
            typicalSource: null,
            sampleCount: 1,
            createdAtUtc: DateTime.UtcNow,
            updatedAtUtc: DateTime.UtcNow);

        Assert.Equal("irrigation", pattern.OperationType);
    }

    // ── WP-2d (D5) Reinforce ─────────────────────────────────────────────────

    [Fact]
    public void Reinforce_increments_sampleCount_and_updates_typical_fields()
    {
        var created = new DateTime(2025, 10, 1, 6, 0, 0, DateTimeKind.Utc);
        var pattern = RoutinePattern.Create(
            Guid.NewGuid(), Farm,
            plotId: Guid.NewGuid(),
            operationType: "irrigation",
            typicalDurationHours: null,
            typicalMethod: null,
            typicalSource: null,
            sampleCount: 1,
            createdAtUtc: created,
            updatedAtUtc: created);

        var reinforced = new DateTime(2025, 10, 5, 7, 0, 0, DateTimeKind.Utc);
        pattern.Reinforce(
            typicalDurationHours: 4.0m,
            typicalMethod: "drip",
            typicalSource: "borewell",
            updatedAtUtc: reinforced);

        Assert.Equal(2, pattern.SampleCount);
        Assert.Equal(4.0m, pattern.TypicalDurationHours); // first non-null → adopt
        Assert.Equal("drip", pattern.TypicalMethod);
        Assert.Equal("borewell", pattern.TypicalSource);
        Assert.Equal(reinforced, pattern.UpdatedAtUtc);
        Assert.Equal(created, pattern.CreatedAtUtc); // unchanged
    }

    [Fact]
    public void Reinforce_running_averages_duration_when_both_present()
    {
        // Start already carrying a typical of 4.0 over 1 sample.
        var ts = new DateTime(2025, 11, 1, 9, 0, 0, DateTimeKind.Utc);
        var pattern = RoutinePattern.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            operationType: "irrigation",
            typicalDurationHours: 4.0m,
            typicalMethod: "drip",
            typicalSource: "borewell",
            sampleCount: 1,
            createdAtUtc: ts,
            updatedAtUtc: ts);

        // Reinforce with 6.0 → running mean over 2 samples = (4*1 + 6) / 2 = 5.0.
        pattern.Reinforce(6.0m, typicalMethod: "flood", typicalSource: null, updatedAtUtc: ts.AddDays(1));

        Assert.Equal(2, pattern.SampleCount);
        Assert.Equal(5.0m, pattern.TypicalDurationHours);
        Assert.Equal("flood", pattern.TypicalMethod);      // last-write when provided
        Assert.Equal("borewell", pattern.TypicalSource);   // null new → keep existing
    }

    [Fact]
    public void Reinforce_keeps_existing_typicals_when_new_values_absent()
    {
        var ts = new DateTime(2025, 12, 1, 9, 0, 0, DateTimeKind.Utc);
        var pattern = RoutinePattern.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            operationType: "irrigation",
            typicalDurationHours: 3.0m,
            typicalMethod: "drip",
            typicalSource: "canal",
            sampleCount: 2,
            createdAtUtc: ts,
            updatedAtUtc: ts);

        pattern.Reinforce(null, typicalMethod: null, typicalSource: "   ", updatedAtUtc: ts.AddDays(1));

        Assert.Equal(3, pattern.SampleCount);
        Assert.Equal(3.0m, pattern.TypicalDurationHours); // null new → unchanged
        Assert.Equal("drip", pattern.TypicalMethod);       // null new → unchanged
        Assert.Equal("canal", pattern.TypicalSource);      // blank new → unchanged
    }
}
