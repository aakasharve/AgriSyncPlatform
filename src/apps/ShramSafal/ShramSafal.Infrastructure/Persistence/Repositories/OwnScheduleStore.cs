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
}
