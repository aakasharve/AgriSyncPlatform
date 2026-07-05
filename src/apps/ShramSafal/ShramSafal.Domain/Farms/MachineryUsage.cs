using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed CHILD of <c>daily_logs</c> (ADR 0023 §1/§2; plan §3.2i) — machine
/// usage with its equipment config. EXISTS-join child: plain <see cref="DailyLogId"/>
/// FK, no farm_id, no Provenance, no version chain.
/// <para><b>§3.2i structured config (load-bearing):</b> the blower/gun/fan/fuel facts
/// live in first-class typed columns (<see cref="Implement"/>, <see cref="NozzlesActive"/>,
/// <see cref="FanState"/>, <see cref="FuelType"/>, <see cref="FuelQuantity"/>,
/// <see cref="OperationPerformed"/>) — NOT in a free-text notes field (there is none).
/// "blower, 10 guns, fan off" persists as Implement='blower', NozzlesActive=10, FanState=Off.</para>
/// </summary>
public sealed class MachineryUsage : Entity<Guid>
{
    private MachineryUsage() : base(Guid.Empty) { } // EF Core

    private MachineryUsage(
        Guid id, Guid dailyLogId, MachineType machineType, Ownership ownership,
        decimal? hoursUsed, decimal? rentalCost, decimal? fuelCost,
        string? implement, int? nozzlesActive, FanState? fanState,
        string? fuelType, decimal? fuelQuantity, string? operationPerformed,
        Guid? linkedActivityId, DateTime createdAtUtc)
        : base(id)
    {
        DailyLogId = dailyLogId;
        MachineType = machineType;
        Ownership = ownership;
        HoursUsed = hoursUsed;
        RentalCost = rentalCost;
        FuelCost = fuelCost;
        Implement = implement;
        NozzlesActive = nozzlesActive;
        FanState = fanState;
        FuelType = fuelType;
        FuelQuantity = fuelQuantity;
        OperationPerformed = operationPerformed;
        LinkedActivityId = linkedActivityId;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid DailyLogId { get; private set; }
    public MachineType MachineType { get; private set; }
    public Ownership Ownership { get; private set; }
    public decimal? HoursUsed { get; private set; }
    public decimal? RentalCost { get; private set; }
    public decimal? FuelCost { get; private set; }
    public string? Implement { get; private set; }           // §3.2i e.g. "blower"
    public int? NozzlesActive { get; private set; }          // §3.2i "10 guns"
    public FanState? FanState { get; private set; }          // §3.2i; null = not mentioned
    public string? FuelType { get; private set; }
    public decimal? FuelQuantity { get; private set; }
    public string? OperationPerformed { get; private set; }
    public Guid? LinkedActivityId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static MachineryUsage Create(
        Guid id, Guid dailyLogId, MachineType machineType, Ownership ownership,
        decimal? hoursUsed, decimal? rentalCost, decimal? fuelCost,
        string? implement, int? nozzlesActive, FanState? fanState,
        string? fuelType, decimal? fuelQuantity, string? operationPerformed,
        Guid? linkedActivityId, DateTime createdAtUtc)
        => new(id, dailyLogId, machineType, ownership, hoursUsed, rentalCost, fuelCost,
               implement, nozzlesActive, fanState, fuelType, fuelQuantity, operationPerformed,
               linkedActivityId, createdAtUtc);
}
