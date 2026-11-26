using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Farms.FarmSetup;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, farm setup on the server, per farm)
//
// Every command names ONE farm, the caller, and the revision the phone last received (`BaseRevision`: 0 for something new). Create and edit are one
// "save": the first save of an id makes the item, a later save edits it. A motor is made, edited and removed only through its source's save.

/// <summary>Who sent a farm-setup change and from where (the audit row's who, command id, app version and device).</summary>
public sealed record FarmSetupCaller(Guid UserId, string? ClientCommandId = null, string ClientAppVersion = "unknown", string AuditDeviceId = "unknown");

/// <summary>The answer of a farm-setup change that was applied (or was already there): the item and its revision now.</summary>
public sealed record FarmSetupResult(Guid Id, int Revision);

/// <summary><c>farmsetup.water_source.save</c>: one source with its WHOLE motor list (a motor not in the list is removed, with its plot links).</summary>
public sealed record SaveWaterSourceCommand(Guid FarmId, Guid WaterSourceId, int BaseRevision, FarmWaterSourceSpec Spec, FarmSetupCaller Caller);

/// <summary><c>farmsetup.water_source.remove</c>: the source and its motors to the removed state; their plot links go with them.</summary>
public sealed record RemoveWaterSourceCommand(Guid FarmId, Guid WaterSourceId, int BaseRevision, FarmSetupCaller Caller);

/// <summary><c>farmsetup.power_times.set</c>: the farm's timetable, whole, as the JSON the phone sent (read strictly by the domain).</summary>
public sealed record SetPowerTimesCommand(Guid FarmId, int BaseRevision, string TimetableJson, FarmSetupCaller Caller);

/// <summary><c>farmsetup.machine.save</c>: one machine of the farm.</summary>
public sealed record SaveMachineCommand(Guid FarmId, Guid MachineId, int BaseRevision, FarmMachineSpec Spec, FarmSetupCaller Caller);

/// <summary><c>farmsetup.machine.remove</c>: the machine to the removed state.</summary>
public sealed record RemoveMachineCommand(Guid FarmId, Guid MachineId, int BaseRevision, FarmSetupCaller Caller);

/// <summary><c>farmsetup.plot_water.set</c>: one plot's method and its WHOLE link list.</summary>
public sealed record SetPlotWaterCommand(Guid FarmId, Guid PlotId, int BaseRevision, PlotWaterSpec Spec, FarmSetupCaller Caller);
