using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 schedule slice 3 - EF Core implementation of <see cref="IOwnScheduleStore"/>. Shares the scoped <see cref="ShramSafalDbContext"/>, so a staged
/// work and its revision are committed by the caller's one save, with the frozen version and the plot's place when they go together.
/// </summary>
internal sealed class OwnScheduleStore(ShramSafalDbContext context) : IOwnScheduleStore
{
    public async Task<OwnScheduleItem?> GetAsync(Guid itemId, CancellationToken ct = default) =>
        await context.OwnScheduleItems.FirstOrDefaultAsync(i => i.Id == itemId, ct);

    public async Task<IReadOnlyList<OwnScheduleItem>> GetSeasonAsync(Guid plotId, Guid cropCycleId, CancellationToken ct = default) =>
        await context.OwnScheduleItems
            .Where(i => i.PlotId == plotId && i.CropCycleId == cropCycleId)
            .OrderBy(i => i.StageIndex)
            .ThenBy(i => i.Order)
            .ThenBy(i => i.TaskKey)
            .ToListAsync(ct);

    public async Task<IReadOnlyList<OwnScheduleItem>> GetOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return [];
        }

        var ids = farmIds.Select(id => new AgriSync.SharedKernel.Contracts.Ids.FarmId(id)).ToList();
        return await context.OwnScheduleItems
            .AsNoTracking()
            .Where(i => ids.Contains(i.FarmId))
            .OrderBy(i => i.PlotId)
            .ThenBy(i => i.StageIndex)
            .ThenBy(i => i.Order)
            .ThenBy(i => i.TaskKey)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<OwnScheduleItemRevision>> GetRevisionsOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return [];
        }

        var ids = farmIds.Select(id => new AgriSync.SharedKernel.Contracts.Ids.FarmId(id)).ToList();
        return await context.OwnScheduleItemRevisions
            .AsNoTracking()
            .Where(r => ids.Contains(r.FarmId))
            .OrderBy(r => r.AtUtc)
            .ThenBy(r => r.ItemId)
            .ThenBy(r => r.RevisionNumber)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlySet<(Guid PlotId, Guid CropCycleId)>> SeasonsWithWorkAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return new HashSet<(Guid, Guid)>();
        }

        var ids = farmIds.Select(id => new AgriSync.SharedKernel.Contracts.Ids.FarmId(id)).ToList();
        var pairs = await context.OwnScheduleItems
            .AsNoTracking()
            .Where(i => ids.Contains(i.FarmId) && i.State == OwnScheduleItemState.Active)
            .Select(i => new { i.PlotId, i.CropCycleId })
            .Distinct()
            .ToListAsync(ct);
        return pairs.Select(p => (p.PlotId, p.CropCycleId)).ToHashSet();
    }

    public void Stage(OwnScheduleItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        context.OwnScheduleItems.Add(item);
    }

    public void Stage(OwnScheduleItemRevision revision)
    {
        ArgumentNullException.ThrowIfNull(revision);
        context.OwnScheduleItemRevisions.Add(revision);
    }

    public async Task<OwnScheduleItemOrigin?> GetOriginAsync(Guid itemId, CancellationToken ct = default) =>
        context.ChangeTracker.Entries<OwnScheduleItemOrigin>().Select(e => e.Entity).Where(o => o.ItemId == itemId).OrderByDescending(o => o.Sequence).FirstOrDefault()
        ?? await context.OwnScheduleItemOrigins.AsNoTracking().Where(o => o.ItemId == itemId).OrderByDescending(o => o.Sequence).FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<OwnScheduleItemOrigin>> GetOriginsOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return [];
        }

        var ids = farmIds.Select(id => new AgriSync.SharedKernel.Contracts.Ids.FarmId(id)).ToList();
        return await context.OwnScheduleItemOrigins
            .AsNoTracking()
            .Where(o => ids.Contains(o.FarmId))
            .OrderBy(o => o.TakenAtUtc)
            .ThenBy(o => o.Sequence)
            .ToListAsync(ct);
    }

    public void Stage(OwnScheduleItemOrigin origin)
    {
        ArgumentNullException.ThrowIfNull(origin);
        context.OwnScheduleItemOrigins.Add(origin);
    }

    public async Task<IReadOnlyList<OwnScheduleSeasonCarry>> GetCarriesAsync(Guid plotId, Guid fromCropCycleId, Guid cropCycleId, CancellationToken ct = default) =>
        await context.OwnScheduleSeasonCarries.AsNoTracking()
            .Where(c => c.PlotId == plotId && c.FromCropCycleId == fromCropCycleId && c.CropCycleId == cropCycleId)
            .OrderBy(c => c.TaskKey)
            .ToListAsync(ct);

    public async Task<IReadOnlyList<OwnScheduleSeasonCarry>> GetCarriesOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return [];
        }

        var ids = farmIds.Select(id => new AgriSync.SharedKernel.Contracts.Ids.FarmId(id)).ToList();
        return await context.OwnScheduleSeasonCarries.AsNoTracking()
            .Where(c => ids.Contains(c.FarmId))
            .OrderBy(c => c.PlotId).ThenBy(c => c.CropCycleId).ThenBy(c => c.TaskKey)
            .ToListAsync(ct);
    }

    public void Stage(OwnScheduleSeasonCarry carry)
    {
        ArgumentNullException.ThrowIfNull(carry);
        context.OwnScheduleSeasonCarries.Add(carry);
    }
}
