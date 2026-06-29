using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class MachineryUsageTests
{
    private static readonly Guid Log = Guid.Parse("77777777-7777-7777-7777-777777777777");

    // THE §3.2i load-bearing acceptance: "blower, 10 guns, fan off" persists as
    // structured typed columns — implement/nozzlesActive/fanState — NOT in notes.
    [Fact]
    public void Create_persists_structured_equipment_config_not_notes()
    {
        var mu = MachineryUsage.Create(Guid.NewGuid(), Log, MachineType.Sprayer, Ownership.Owned,
            hoursUsed: null, rentalCost: null, fuelCost: null,
            implement: "blower", nozzlesActive: 10, fanState: FanState.Off,
            fuelType: null, fuelQuantity: null, operationPerformed: "spraying",
            linkedActivityId: null, createdAtUtc: new DateTime(2025, 10, 19, 0, 0, 0, DateTimeKind.Utc));
        Assert.Equal("blower", mu.Implement);
        Assert.Equal(10, mu.NozzlesActive);
        Assert.Equal(FanState.Off, mu.FanState);
        Assert.Equal("spraying", mu.OperationPerformed);
        Assert.Equal(MachineType.Sprayer, mu.MachineType);
        Assert.Equal(Ownership.Owned, mu.Ownership);
    }

    [Fact]
    public void Create_sets_hours_and_costs()
    {
        var mu = MachineryUsage.Create(Guid.NewGuid(), Log, MachineType.Tractor, Ownership.Rented,
            hoursUsed: 3.5m, rentalCost: 1200m, fuelCost: 800m,
            implement: null, nozzlesActive: null, fanState: null,
            fuelType: "diesel", fuelQuantity: 12m, operationPerformed: "ploughing",
            linkedActivityId: null, createdAtUtc: DateTime.UtcNow);
        Assert.Equal(3.5m, mu.HoursUsed);
        Assert.Equal(1200m, mu.RentalCost);
        Assert.Equal(800m, mu.FuelCost);
        Assert.Equal("diesel", mu.FuelType);
        Assert.Equal(12m, mu.FuelQuantity);
    }

    [Fact]
    public void Create_allows_null_fan_state_and_optionals()
    {
        var mu = MachineryUsage.Create(Guid.NewGuid(), Log, MachineType.Unknown, Ownership.Unknown,
            null, null, null, null, null, null, null, null, null, null, DateTime.UtcNow);
        Assert.Null(mu.FanState);          // not mentioned — no fabricated state
        Assert.Null(mu.Implement);
        Assert.Null(mu.NozzlesActive);
        Assert.Null(mu.HoursUsed);
        Assert.Equal(MachineType.Unknown, mu.MachineType);
    }
}
