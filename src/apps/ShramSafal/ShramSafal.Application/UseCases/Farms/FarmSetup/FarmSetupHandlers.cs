using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Farms.FarmSetup;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9; founder 27 Nov: "send it to server; the phone is only a door")
//
// The six doors of a farm's setup. Every handler asks the same things in the same order, and writes nothing until all of them pass:
//   1. invalid command (an empty id, a negative base revision)            -> ShramSafal.InvalidCommand
//   2. the farm exists                                                    -> ShramSafal.FarmNotFound
//   3. the caller may edit THIS farm's setup (FarmAuthority.EditFarmSetup: the registrant always; anyone else needs an Active seat that holds it
//      AND covers every plot; a label grants nothing), then the entitlement gate add-plot uses (PaidFeature.CreatePlot)
//                                                                         -> ShramSafal.Forbidden / entitlement.*
//   4. what the change names is part of THIS farm's setup (the plot: ShramSafal.PlotNotFound; a source, motor or machine that is unknown, removed or
//      another farm's reads as "changed elsewhere", which is what a phone sees when another phone removed it)
//   5. the conflict rule: the stored revision equals the phone's base revision; if not, the same content already there is answered as saved with
//      nothing written, anything else is refused                         -> ShramSafal.FarmSetup.Conflict
//   6. the content holds together                                         -> ShramSafal.FarmSetupInvalid
// A real change writes ONE audit row (who, role, farm, entity, before, after: doctrine P3) in the same save. Two saves landing in the same instant:
// the revision is the row's concurrency token, the store answers ChangedElsewhere, and the handler returns the same conflict refusal.

/// <summary><c>farmsetup.water_source.save</c>.</summary>
public sealed class SaveWaterSourceHandler(IShramSafalRepository repository, IFarmSetupStore store, IEntitlementPolicy entitlementPolicy, IClock clock)
{
    public async Task<Result<FarmSetupResult>> HandleAsync(SaveWaterSourceCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.WaterSourceId == Guid.Empty || command.Caller is null || command.Caller.UserId == Guid.Empty
            || command.BaseRevision < 0 || command.Spec is null)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        var (role, refusal) = await FarmSetupGate.OpenAsync(repository, entitlementPolicy, command.FarmId, command.Caller.UserId, now, ct);
        if (refusal is not null)
        {
            return Result.Failure<FarmSetupResult>(refusal);
        }

        var source = await store.GetWaterSourceAsync(command.WaterSourceId, ct);
        if (source is not null && (Guid)source.FarmId != command.FarmId)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        // A motor belongs to ONE source: an id another source already holds is never moved or taken over.
        var motorIds = (command.Spec.Motors ?? []).Where(m => m is not null && m.MotorId != Guid.Empty).Select(m => m.MotorId).Distinct().ToList();
        if (motorIds.Count > 0
            && (await store.GetMotorsAsync(motorIds, ct)).Any(m => m.WaterSourceId != command.WaterSourceId || (Guid)m.FarmId != command.FarmId))
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupInvalid("FarmMotorPlace", "A motor belongs to one water source of one farm."));
        }

        if (source is null ? command.BaseRevision != 0 : command.BaseRevision != source.Revision)
        {
            return source is not null && source.Matches(command.Spec)
                ? Result.Success(new FarmSetupResult(source.Id, source.Revision))
                : Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        if (command.Spec.Check() is { } problem)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupInvalid(problem.Code, problem.Message));
        }

        var by = new UserId(command.Caller.UserId);
        var before = source is null ? null : FarmSetupAudit.Of(source);
        IReadOnlyList<Guid> removedMotors = [];
        if (source is null)
        {
            source = FarmWaterSource.Create(command.WaterSourceId, new FarmId(command.FarmId), command.Spec, by, now);
        }
        else if (!source.Change(command.Spec, by, now, out removedMotors))
        {
            return Result.Success(new FarmSetupResult(source.Id, source.Revision));
        }

        store.Stage(source);
        var unlinked = new List<Guid>();
        if (removedMotors.Count > 0)
        {
            foreach (var plot in await store.GetPlotWaterLinkedToSourceAsync(source.Id, ct))
            {
                if (plot.DropLinksToMotors(removedMotors, by, now))
                {
                    store.Stage(plot);
                    unlinked.Add(plot.Id);
                }
            }
        }

        await FarmSetupAudit.AddAsync(
            repository, "FarmWaterSource", source.Id, "FarmWaterSourceSaved", command.Caller, role, command.FarmId,
            new { farmId = command.FarmId, waterSourceId = source.Id, revision = source.Revision, before, after = FarmSetupAudit.Of(source), unlinkedPlotIds = unlinked }, ct);
        return await FarmSetupAudit.SaveAsync(store, source.Id, source.Revision, ct);
    }
}

/// <summary><c>farmsetup.water_source.remove</c>. Removing a removed source changes nothing and is answered as saved.</summary>
public sealed class RemoveWaterSourceHandler(IShramSafalRepository repository, IFarmSetupStore store, IEntitlementPolicy entitlementPolicy, IClock clock)
{
    public async Task<Result<FarmSetupResult>> HandleAsync(RemoveWaterSourceCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.WaterSourceId == Guid.Empty || command.Caller is null || command.Caller.UserId == Guid.Empty
            || command.BaseRevision < 1)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        var (role, refusal) = await FarmSetupGate.OpenAsync(repository, entitlementPolicy, command.FarmId, command.Caller.UserId, now, ct);
        if (refusal is not null)
        {
            return Result.Failure<FarmSetupResult>(refusal);
        }

        var source = await store.GetWaterSourceAsync(command.WaterSourceId, ct);
        if (source is null || (Guid)source.FarmId != command.FarmId)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        if (source.State == FarmSetupState.Removed)
        {
            return Result.Success(new FarmSetupResult(source.Id, source.Revision));
        }

        if (command.BaseRevision != source.Revision)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        var by = new UserId(command.Caller.UserId);
        var before = FarmSetupAudit.Of(source);
        source.Remove(by, now, out _);
        store.Stage(source);
        var unlinked = new List<Guid>();
        foreach (var plot in await store.GetPlotWaterLinkedToSourceAsync(source.Id, ct))
        {
            if (plot.DropLinksToSource(source.Id, by, now))
            {
                store.Stage(plot);
                unlinked.Add(plot.Id);
            }
        }

        await FarmSetupAudit.AddAsync(
            repository, "FarmWaterSource", source.Id, "FarmWaterSourceRemoved", command.Caller, role, command.FarmId,
            new { farmId = command.FarmId, waterSourceId = source.Id, revision = source.Revision, before, after = FarmSetupAudit.Of(source), unlinkedPlotIds = unlinked }, ct);
        return await FarmSetupAudit.SaveAsync(store, source.Id, source.Revision, ct);
    }
}

/// <summary><c>farmsetup.power_times.set</c>: the farm's timetable, whole. The answer's id is the farm's id.</summary>
public sealed class SetPowerTimesHandler(IShramSafalRepository repository, IFarmSetupStore store, IEntitlementPolicy entitlementPolicy, IClock clock)
{
    public async Task<Result<FarmSetupResult>> HandleAsync(SetPowerTimesCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.Caller is null || command.Caller.UserId == Guid.Empty || command.BaseRevision < 0
            || string.IsNullOrWhiteSpace(command.TimetableJson))
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        var (role, refusal) = await FarmSetupGate.OpenAsync(repository, entitlementPolicy, command.FarmId, command.Caller.UserId, now, ct);
        if (refusal is not null)
        {
            return Result.Failure<FarmSetupResult>(refusal);
        }

        var times = await store.GetPowerTimesAsync(command.FarmId, ct);
        var holds = PowerTimetable.TryParse(command.TimetableJson, out var timetable, out var problem);
        if (times is null ? command.BaseRevision != 0 : command.BaseRevision != times.Revision)
        {
            return times is not null && holds && times.Matches(timetable!)
                ? Result.Success(new FarmSetupResult(command.FarmId, times.Revision))
                : Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        if (!holds)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupInvalid(problem!.Code, problem.Message));
        }

        var by = new UserId(command.Caller.UserId);
        var before = times is null ? (JsonElement?)null : FarmSetupAudit.Json(times.Content);
        if (times is null)
        {
            times = FarmPowerTimes.Create(new FarmId(command.FarmId), timetable!, by, now);
        }
        else if (!times.Change(timetable!, by, now))
        {
            return Result.Success(new FarmSetupResult(command.FarmId, times.Revision));
        }

        store.Stage(times);
        await FarmSetupAudit.AddAsync(
            repository, "FarmPowerTimes", command.FarmId, "FarmPowerTimesSet", command.Caller, role, command.FarmId,
            new { farmId = command.FarmId, revision = times.Revision, contentHash = times.ContentHash, before, after = FarmSetupAudit.Json(timetable!.CanonicalJson) }, ct);
        return await FarmSetupAudit.SaveAsync(store, command.FarmId, times.Revision, ct);
    }
}

/// <summary><c>farmsetup.machine.save</c>.</summary>
public sealed class SaveMachineHandler(IShramSafalRepository repository, IFarmSetupStore store, IEntitlementPolicy entitlementPolicy, IClock clock)
{
    public async Task<Result<FarmSetupResult>> HandleAsync(SaveMachineCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.MachineId == Guid.Empty || command.Caller is null || command.Caller.UserId == Guid.Empty
            || command.BaseRevision < 0 || command.Spec is null)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        var (role, refusal) = await FarmSetupGate.OpenAsync(repository, entitlementPolicy, command.FarmId, command.Caller.UserId, now, ct);
        if (refusal is not null)
        {
            return Result.Failure<FarmSetupResult>(refusal);
        }

        var machine = await store.GetMachineAsync(command.MachineId, ct);
        if (machine is not null && (Guid)machine.FarmId != command.FarmId)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        if (machine is null ? command.BaseRevision != 0 : command.BaseRevision != machine.Revision)
        {
            return machine is not null && machine.Matches(command.Spec)
                ? Result.Success(new FarmSetupResult(machine.Id, machine.Revision))
                : Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        if (command.Spec.Check() is { } problem)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupInvalid(problem.Code, problem.Message));
        }

        var by = new UserId(command.Caller.UserId);
        var before = machine is null ? null : FarmSetupAudit.Of(machine);
        if (machine is null)
        {
            machine = FarmMachine.Create(command.MachineId, new FarmId(command.FarmId), command.Spec, by, now);
        }
        else if (!machine.Change(command.Spec, by, now))
        {
            return Result.Success(new FarmSetupResult(machine.Id, machine.Revision));
        }

        store.Stage(machine);
        await FarmSetupAudit.AddAsync(
            repository, "FarmMachine", machine.Id, "FarmMachineSaved", command.Caller, role, command.FarmId,
            new { farmId = command.FarmId, machineId = machine.Id, revision = machine.Revision, before, after = FarmSetupAudit.Of(machine) }, ct);
        return await FarmSetupAudit.SaveAsync(store, machine.Id, machine.Revision, ct);
    }
}

/// <summary><c>farmsetup.machine.remove</c>. Removing a removed machine changes nothing and is answered as saved.</summary>
public sealed class RemoveMachineHandler(IShramSafalRepository repository, IFarmSetupStore store, IEntitlementPolicy entitlementPolicy, IClock clock)
{
    public async Task<Result<FarmSetupResult>> HandleAsync(RemoveMachineCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.MachineId == Guid.Empty || command.Caller is null || command.Caller.UserId == Guid.Empty
            || command.BaseRevision < 1)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        var (role, refusal) = await FarmSetupGate.OpenAsync(repository, entitlementPolicy, command.FarmId, command.Caller.UserId, now, ct);
        if (refusal is not null)
        {
            return Result.Failure<FarmSetupResult>(refusal);
        }

        var machine = await store.GetMachineAsync(command.MachineId, ct);
        if (machine is null || (Guid)machine.FarmId != command.FarmId)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        if (machine.State == FarmSetupState.Removed)
        {
            return Result.Success(new FarmSetupResult(machine.Id, machine.Revision));
        }

        if (command.BaseRevision != machine.Revision)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        var before = FarmSetupAudit.Of(machine);
        machine.Remove(new UserId(command.Caller.UserId), now);
        store.Stage(machine);
        await FarmSetupAudit.AddAsync(
            repository, "FarmMachine", machine.Id, "FarmMachineRemoved", command.Caller, role, command.FarmId,
            new { farmId = command.FarmId, machineId = machine.Id, revision = machine.Revision, before, after = FarmSetupAudit.Of(machine) }, ct);
        return await FarmSetupAudit.SaveAsync(store, machine.Id, machine.Revision, ct);
    }
}

/// <summary>
/// <c>farmsetup.plot_water.set</c>: one plot's method and its whole link list. The plot, every source and every motor must be THIS farm's and part of its
/// setup now; a motor must be a motor of the source it is named with. A method with no link is saved (the plot shows बाकी). The answer's id is the plot's id.
/// </summary>
public sealed class SetPlotWaterHandler(IShramSafalRepository repository, IFarmSetupStore store, IEntitlementPolicy entitlementPolicy, IClock clock)
{
    public async Task<Result<FarmSetupResult>> HandleAsync(SetPlotWaterCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.PlotId == Guid.Empty || command.Caller is null || command.Caller.UserId == Guid.Empty
            || command.BaseRevision < 0 || command.Spec is null)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        var (role, refusal) = await FarmSetupGate.OpenAsync(repository, entitlementPolicy, command.FarmId, command.Caller.UserId, now, ct);
        if (refusal is not null)
        {
            return Result.Failure<FarmSetupResult>(refusal);
        }

        var plot = await repository.GetPlotByIdAsync(command.PlotId, ct);
        if (plot is null || plot.Id != command.PlotId || (Guid)plot.FarmId != command.FarmId)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.PlotNotFound);
        }

        // Every source and motor named must be an ACTIVE part of this farm's setup, the motor a motor of that source. One that is unknown, removed or
        // another farm's (which reads as nothing under this farm's scope) is what a phone sees after another phone removed it.
        foreach (var named in (command.Spec.Links ?? []).Where(l => l is not null && l.WaterSourceId != Guid.Empty).GroupBy(l => l.WaterSourceId))
        {
            var source = await store.GetWaterSourceAsync(named.Key, ct);
            if (source is null || (Guid)source.FarmId != command.FarmId || source.State != FarmSetupState.Active
                || named.Any(l => l.MotorId is { } motorId && !source.Motors.Any(m => m.Id == motorId && m.State == FarmSetupState.Active)))
            {
                return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
            }
        }

        var setup = await store.GetPlotWaterAsync(command.PlotId, ct);
        if (setup is not null && (Guid)setup.FarmId != command.FarmId)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.PlotNotFound);
        }

        if (setup is null ? command.BaseRevision != 0 : command.BaseRevision != setup.Revision)
        {
            return setup is not null && setup.Matches(command.Spec)
                ? Result.Success(new FarmSetupResult(setup.Id, setup.Revision))
                : Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);
        }

        if (command.Spec.Check() is { } problem)
        {
            return Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupInvalid(problem.Code, problem.Message));
        }

        var by = new UserId(command.Caller.UserId);
        var before = setup is null ? null : FarmSetupAudit.Of(setup);
        if (setup is null)
        {
            setup = PlotWaterSetup.Create(command.PlotId, new FarmId(command.FarmId), command.Spec, by, now);
        }
        else if (!setup.Set(command.Spec, by, now))
        {
            return Result.Success(new FarmSetupResult(setup.Id, setup.Revision));
        }

        store.Stage(setup);
        await FarmSetupAudit.AddAsync(
            repository, "PlotWaterSetup", setup.Id, "PlotWaterSet", command.Caller, role, command.FarmId,
            new { farmId = command.FarmId, plotId = setup.Id, revision = setup.Revision, before, after = FarmSetupAudit.Of(setup) }, ct);
        return await FarmSetupAudit.SaveAsync(store, setup.Id, setup.Revision, ct);
    }
}

/// <summary>Steps 2 and 3 of every farm-setup handler: the farm exists, the caller may edit its setup, and the entitlement gate add-plot uses.</summary>
internal static class FarmSetupGate
{
    internal static async Task<(AppRole Role, Error? Refusal)> OpenAsync(
        IShramSafalRepository repository, IEntitlementPolicy entitlementPolicy, Guid farmId, Guid userId, DateTime now, CancellationToken ct)
    {
        if (await repository.GetFarmByIdAsync(farmId, ct) is null)
        {
            return (default, ShramSafalErrors.FarmNotFound);
        }

        // The same gate add-plot and the plot group use: "edit farm setup" from THIS farm's seat. The role is read for the audit row only.
        var role = await repository.GetUserRoleForFarmAsync(farmId, userId, ct);
        if (role is null || !await FarmAuthorityGate.HoldsAsync(repository, farmId, userId, FarmAuthority.EditFarmSetup, now, ct))
        {
            return (default, ShramSafalErrors.Forbidden);
        }

        var entitlement = await EntitlementGate.CheckErrorAsync(entitlementPolicy, new UserId(userId), new FarmId(farmId), PaidFeature.CreatePlot, ct);
        return (role.Value, entitlement);
    }
}

/// <summary>The audit row every real change writes (before and after), and the save both ends share.</summary>
internal static class FarmSetupAudit
{
    internal static Task AddAsync(
        IShramSafalRepository repository, string entityType, Guid entityId, string action, FarmSetupCaller caller, AppRole role, Guid farmId, object payload,
        CancellationToken ct) =>
        repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: entityType,
                entityId: entityId,
                action: action,
                actorUserId: caller.UserId,
                actorRole: role.ToString(),
                payload: payload,
                farmId: farmId,
                clientCommandId: caller.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(caller.ClientAppVersion) ? "unknown" : caller.ClientAppVersion,
                deviceId: string.IsNullOrWhiteSpace(caller.AuditDeviceId) ? "unknown" : caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);

    internal static async Task<Result<FarmSetupResult>> SaveAsync(IFarmSetupStore store, Guid id, int revision, CancellationToken ct) =>
        await store.TrySaveAsync(ct) == FarmSetupSave.Saved
            ? Result.Success(new FarmSetupResult(id, revision))
            : Result.Failure<FarmSetupResult>(ShramSafalErrors.FarmSetupChangedElsewhere);

    internal static string Word(FarmSetupState state) => state == FarmSetupState.Active ? "active" : "removed";

    internal static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    internal static object Of(FarmWaterSource source) => new
    {
        name = source.Name,
        sourceType = source.SourceType,
        isAvailable = source.IsAvailable,
        notes = source.Notes,
        state = Word(source.State),
        motors = source.Motors
            .Where(m => m.State == FarmSetupState.Active)
            .Select(m => new
            {
                id = m.Id,
                name = m.Name,
                hp = m.Hp,
                phase = m.Phase,
                powerSource = m.PowerSource,
                powerSourceName = m.PowerSourceName,
                drip = m.HasDrip ? new { pipeSize = m.DripPipeSize, hasFilter = m.DripHasFilter, flowLitresPerHour = m.DripFlowLph } : null,
            })
            .ToList(),
    };

    internal static object Of(FarmMachine machine) => new
    {
        name = machine.Name,
        machineType = machine.MachineType,
        ownership = machine.Ownership,
        company = machine.Company,
        model = machine.Model,
        hp = machine.Hp,
        nozzleCount = machine.NozzleCount,
        tankLitres = machine.TankLitres,
        detailLine = machine.DetailLine,
        state = Word(machine.State),
    };

    internal static object Of(PlotWaterSetup setup) => new
    {
        method = setup.Method,
        links = setup.Links
            .Where(l => l.State == FarmSetupState.Active)
            .Select(l => new { waterSourceId = l.WaterSourceId, motorId = l.MotorId })
            .ToList(),
    };
}
