using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 repair D-9 - EF Core implementation of <see cref="IFarmSetupStore"/>. Shares the scoped <see cref="ShramSafalDbContext"/>, so a farm-setup
/// change and its audit row are committed by one save. The six tables have no foreign key and no navigation (on purpose, see
/// <c>FarmSetupConfiguration</c>): a parent's children are read with it and attached here.
/// </summary>
internal sealed class FarmSetupStore(ShramSafalDbContext context) : IFarmSetupStore
{
    private const string Savepoint = "ssf_farm_setup";

    /// <summary>The unique constraints of the six tables: an id (or a link pair) another save took first.</summary>
    private static readonly string[] OwnUniqueConstraints =
    [
        "PK_farm_water_sources", "PK_farm_motors", "PK_farm_power_times", "PK_farm_machines", "PK_plot_water_setups", "PK_plot_water_links",
        "ux_plot_water_links_pair",
    ];

    public async Task<FarmWaterSource?> GetWaterSourceAsync(Guid waterSourceId, CancellationToken ct = default)
    {
        var source = await context.FarmWaterSources.FirstOrDefaultAsync(s => s.Id == waterSourceId, ct);
        if (source is null)
        {
            return null;
        }

        source.AttachMotors(await context.FarmMotors.Where(m => m.WaterSourceId == waterSourceId).ToListAsync(ct));
        return source;
    }

    public async Task<IReadOnlyList<FarmMotor>> GetMotorsAsync(IReadOnlyCollection<Guid> motorIds, CancellationToken ct = default)
    {
        if (motorIds.Count == 0)
        {
            return [];
        }

        var ids = motorIds.ToList();
        return await context.FarmMotors.Where(m => ids.Contains(m.Id)).ToListAsync(ct);
    }

    public async Task<FarmPowerTimes?> GetPowerTimesAsync(Guid farmId, CancellationToken ct = default) =>
        await context.FarmPowerTimes.FirstOrDefaultAsync(p => p.Id == farmId, ct);

    public async Task<FarmMachine?> GetMachineAsync(Guid machineId, CancellationToken ct = default) =>
        await context.FarmMachines.FirstOrDefaultAsync(m => m.Id == machineId, ct);

    public async Task<PlotWaterSetup?> GetPlotWaterAsync(Guid plotId, CancellationToken ct = default)
    {
        var setup = await context.PlotWaterSetups.FirstOrDefaultAsync(p => p.Id == plotId, ct);
        if (setup is null)
        {
            return null;
        }

        setup.AttachLinks(await context.PlotWaterLinks.Where(l => l.PlotId == plotId).ToListAsync(ct));
        return setup;
    }

    public async Task<IReadOnlyList<PlotWaterSetup>> GetPlotWaterLinkedToSourceAsync(Guid waterSourceId, CancellationToken ct = default)
    {
        var plotIds = await context.PlotWaterLinks
            .Where(l => l.WaterSourceId == waterSourceId && l.State == FarmSetupState.Active)
            .Select(l => l.PlotId)
            .Distinct()
            .ToListAsync(ct);
        var setups = new List<PlotWaterSetup>(plotIds.Count);
        foreach (var plotId in plotIds.Order())
        {
            if (await GetPlotWaterAsync(plotId, ct) is { } setup)
            {
                setups.Add(setup);
            }
        }

        return setups;
    }

    public void Stage(FarmWaterSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        AddIfNew(source);
        foreach (var motor in source.Motors)
        {
            AddIfNew(motor);
        }
    }

    public void Stage(FarmPowerTimes powerTimes)
    {
        ArgumentNullException.ThrowIfNull(powerTimes);
        AddIfNew(powerTimes);
    }

    public void Stage(FarmMachine machine)
    {
        ArgumentNullException.ThrowIfNull(machine);
        AddIfNew(machine);
    }

    public void Stage(PlotWaterSetup plotWater)
    {
        ArgumentNullException.ThrowIfNull(plotWater);
        AddIfNew(plotWater);
        foreach (var link in plotWater.Links)
        {
            AddIfNew(link);
        }
    }

    public async Task<FarmSetupRows> GetOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return new FarmSetupRows([], [], [], []);
        }

        var plain = farmIds.ToList();
        var ids = plain.Select(id => new FarmId(id)).ToList();
        var sources = await context.FarmWaterSources.AsNoTracking().Where(s => ids.Contains(s.FarmId)).OrderBy(s => s.CreatedAtUtc).ThenBy(s => s.Id).ToListAsync(ct);
        var motors = (await context.FarmMotors.AsNoTracking().Where(m => ids.Contains(m.FarmId)).ToListAsync(ct)).ToLookup(m => m.WaterSourceId);
        foreach (var source in sources)
        {
            // E4: a motor is trusted under its source only when it names the same farm (the trigger says so too).
            source.AttachMotors(motors[source.Id].Where(m => m.FarmId == source.FarmId));
        }

        var powerTimes = await context.FarmPowerTimes.AsNoTracking().Where(p => plain.Contains(p.Id)).ToListAsync(ct);
        var machines = await context.FarmMachines.AsNoTracking().Where(m => ids.Contains(m.FarmId)).OrderBy(m => m.CreatedAtUtc).ThenBy(m => m.Id).ToListAsync(ct);
        var setups = await context.PlotWaterSetups.AsNoTracking().Where(p => ids.Contains(p.FarmId)).OrderBy(p => p.Id).ToListAsync(ct);
        var links = (await context.PlotWaterLinks.AsNoTracking().Where(l => ids.Contains(l.FarmId)).ToListAsync(ct)).ToLookup(l => l.PlotId);
        foreach (var setup in setups)
        {
            setup.AttachLinks(links[setup.Id].Where(l => l.FarmId == setup.FarmId));
        }

        return new FarmSetupRows(sources, powerTimes, machines, setups);
    }

    public async Task<IReadOnlySet<Guid>> GetFarmsAllowingOwnBillApprovalAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return new HashSet<Guid>();
        }

        var ids = farmIds.Select(id => new FarmId(id)).ToList();
        var on = await context.Farms.AsNoTracking().Where(f => ids.Contains(f.Id) && f.ReviewerMayApproveOwnBill).Select(f => f.Id).ToListAsync(ct);
        return on.Select(id => id.Value).ToHashSet();
    }

    public async Task<FarmSetupSave> TrySaveAsync(CancellationToken ct = default)
    {
        // Inside a sync mutation the save runs in the mutation's transaction, and Postgres aborts a transaction on a unique violation: a SAVEPOINT lets
        // the batch go on after a lost race (as TrySaveScheduleSubscriptionAsync does). Without an ambient transaction this save opens its own, because it
        // writes in two steps (below) and they must land together or not at all.
        var relational = context.Database.IsRelational();
        var ambient = relational ? context.Database.CurrentTransaction : null;
        var own = relational && ambient is null ? await context.Database.BeginTransactionAsync(ct) : null;
        if (ambient is not null)
        {
            await ambient.CreateSavepointAsync(Savepoint, ct);
        }

        try
        {
            // A NEW child row (a motor, a plot link) is written AFTER everything else: its place trigger reads its parent row, and with no foreign key
            // EF does not order a new source before its new motors in one batch.
            var children = context.ChangeTracker.Entries()
                .Where(e => e.State == EntityState.Added && e.Entity is FarmMotor or PlotWaterLink)
                .Select(e => e.Entity)
                .ToList();
            foreach (var child in children)
            {
                context.Entry(child).State = EntityState.Detached;
            }

            try
            {
                await context.SaveChangesAsync(ct);
            }
            finally
            {
                // Back in the unit of work whatever happened, so a refusal below discards them with the rest.
                foreach (var child in children)
                {
                    context.Add(child);
                }
            }

            if (children.Count > 0)
            {
                await context.SaveChangesAsync(ct);
            }

            if (ambient is not null)
            {
                await ambient.ReleaseSavepointAsync(Savepoint, ct);
            }

            if (own is not null)
            {
                await own.CommitAsync(ct);
            }

            return FarmSetupSave.Saved;
        }
        catch (Exception ex) when (ex is DbUpdateConcurrencyException || (ex is DbUpdateException update && IsOwnUniqueViolation(update)))
        {
            // The revision moved under this save, or the id was taken first. Nothing of this unit is kept.
            if (ambient is not null)
            {
                await ambient.RollbackToSavepointAsync(Savepoint, ct);
            }

            if (own is not null)
            {
                await own.RollbackAsync(ct);
            }

            // Discard everything this unit staged (the rows, their children, the audit row) so a later SaveChanges cannot replay the doomed writes.
            foreach (var entry in context.ChangeTracker.Entries()
                         .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                         .ToList())
            {
                entry.State = EntityState.Detached;
            }

            return FarmSetupSave.ChangedElsewhere;
        }
        finally
        {
            if (own is not null)
            {
                await own.DisposeAsync();
            }
        }
    }

    private void AddIfNew(object entity)
    {
        if (context.Entry(entity).State == EntityState.Detached)
        {
            context.Add(entity);
        }
    }

    private static bool IsOwnUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg
        && pg.ConstraintName is { } constraint
        && OwnUniqueConstraints.Contains(constraint, StringComparer.Ordinal);
}
