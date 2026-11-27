using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Ports;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, farm setup on the server, per farm; repair D-177 for the one switch read)

/// <summary>What the database said about a farm-setup save.</summary>
public enum FarmSetupSave
{
    Saved,

    /// <summary>Another save changed the same unit first (its revision moved, or its id was taken): nothing of this unit of work was kept.</summary>
    ChangedElsewhere,
}

/// <summary>
/// The farm-setup rows of some farms, as the pull reads them (not tracked): each water source has its motors attached and each plot's water setup has its
/// links attached, active and removed alike (the reader sends the active ones).
/// </summary>
public sealed record FarmSetupRows(
    IReadOnlyList<FarmWaterSource> WaterSources,
    IReadOnlyList<FarmPowerTimes> PowerTimes,
    IReadOnlyList<FarmMachine> Machines,
    IReadOnlyList<PlotWaterSetup> PlotWater);

/// <summary>
/// A farm's setup on the server: water sources with their motors, the power timetable, machines, and each plot's water arrangement (the six
/// <c>ssf.farm_*</c> / <c>ssf.plot_water_*</c> tables of migration <c>AddFarmSetup</c>). Shares the request's unit of work. A port of its own (like
/// <see cref="IOwnScheduleStore"/>) so the implementors of <see cref="IShramSafalRepository"/> are untouched (F7). Every read is under the request's row
/// security: under a farm's scope only that farm's rows exist, so an id of another farm reads as nothing.
/// </summary>
public interface IFarmSetupStore
{
    /// <summary>One water source by id with its motors attached (active and removed), TRACKED, or null.</summary>
    Task<FarmWaterSource?> GetWaterSourceAsync(Guid waterSourceId, CancellationToken ct = default);

    /// <summary>The motors with these ids that the caller can see, whatever their source (to refuse a motor id another source already holds).</summary>
    Task<IReadOnlyList<FarmMotor>> GetMotorsAsync(IReadOnlyCollection<Guid> motorIds, CancellationToken ct = default);

    /// <summary>The farm's power timetable, TRACKED, or null when it has none yet.</summary>
    Task<FarmPowerTimes?> GetPowerTimesAsync(Guid farmId, CancellationToken ct = default);

    /// <summary>One machine by id, TRACKED, or null.</summary>
    Task<FarmMachine?> GetMachineAsync(Guid machineId, CancellationToken ct = default);

    /// <summary>One plot's water setup with its links attached (active and removed), TRACKED, or null when the plot never answered.</summary>
    Task<PlotWaterSetup?> GetPlotWaterAsync(Guid plotId, CancellationToken ct = default);

    /// <summary>Every plot water setup that holds an ACTIVE link to this water source (with or without a motor), TRACKED, links attached.</summary>
    Task<IReadOnlyList<PlotWaterSetup>> GetPlotWaterLinkedToSourceAsync(Guid waterSourceId, CancellationToken ct = default);

    /// <summary>Makes sure the source and every motor it holds will be written by the next save (a new source, and a new motor of a known source).</summary>
    void Stage(FarmWaterSource source);

    void Stage(FarmPowerTimes powerTimes);

    void Stage(FarmMachine machine);

    /// <summary>Makes sure the plot's setup and every link it holds will be written by the next save.</summary>
    void Stage(PlotWaterSetup plotWater);

    /// <summary>Every farm-setup row of these farms, NOT tracked: the pull's read, under the reader's user scope.</summary>
    Task<FarmSetupRows> GetOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>repair D-177 - which of these farms have the owner's own-bill switch ON (the pull's read; off is the default and is never listed).</summary>
    Task<IReadOnlySet<Guid>> GetFarmsAllowingOwnBillApprovalAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>
    /// Saves the unit of work. A revision that moved under this save, or an id another save took first, is answered <see cref="FarmSetupSave.ChangedElsewhere"/>
    /// with nothing kept (the Application layer never catches a database exception, F6); the handler answers the conflict refusal.
    /// </summary>
    Task<FarmSetupSave> TrySaveAsync(CancellationToken ct = default);
}
