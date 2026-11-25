using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 schedule slice 12b - EF Core implementation of <see cref="IOwnerVoiceStore"/>. Shares the scoped <see cref="ShramSafalDbContext"/>, so what is staged is committed by the
/// caller's one save. Every read runs under the request's row security: a message of a schedule the farm does not follow is not visible to its scope at all.
/// </summary>
internal sealed class OwnerVoiceStore(ShramSafalDbContext context) : IOwnerVoiceStore
{
    public async Task<ScheduleOwnerMessage?> GetMessageAsync(Guid messageId, CancellationToken ct = default) =>
        await context.ScheduleOwnerMessages.AsNoTracking().FirstOrDefaultAsync(m => m.Id == messageId, ct);

    public async Task<ScheduleOwnerClip?> GetClipAsync(Guid clipId, CancellationToken ct = default) =>
        await context.ScheduleOwnerClips.AsNoTracking().FirstOrDefaultAsync(c => c.Id == clipId, ct);

    public async Task<IReadOnlyList<ScheduleOwnerMessage>> GetMessagesOfChainAsync(Guid chainId, CancellationToken ct = default) =>
        await context.ScheduleOwnerMessages.AsNoTracking().Where(m => m.ChainId == chainId).OrderBy(m => m.SentAtUtc).ThenBy(m => m.Id).ToListAsync(ct);

    public async Task<IReadOnlyList<ScheduleOwnerClip>> GetClipsAsync(IReadOnlyCollection<Guid> clipIds, CancellationToken ct = default)
    {
        if (clipIds.Count == 0)
        {
            return [];
        }

        var ids = clipIds.ToList();
        return await context.ScheduleOwnerClips.AsNoTracking().Where(c => ids.Contains(c.Id)).OrderBy(c => c.CreatedAtUtc).ThenBy(c => c.Id).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<ScheduleOwnerMessage>> GetMessagesForFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return [];
        }

        var chains = await ChainsOfFarmsAsync(farmIds, ct);
        if (chains.Count == 0)
        {
            return [];
        }

        var list = chains.ToList();
        return await context.ScheduleOwnerMessages.AsNoTracking().Where(m => list.Contains(m.ChainId)).OrderBy(m => m.SentAtUtc).ThenBy(m => m.Id).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<ScheduleOwnerMessageState>> GetStatesOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return [];
        }

        var ids = farmIds.Select(id => new FarmId(id)).ToList();
        return await context.ScheduleOwnerMessageStates.AsNoTracking()
            .Where(s => ids.Contains(s.FarmId))
            .OrderBy(s => s.AtUtc).ThenBy(s => s.Sequence).ThenBy(s => s.Id)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<ScheduleOwnerMessageState>> GetStatesAsync(Guid plotId, Guid messageId, CancellationToken ct = default)
    {
        var saved = await context.ScheduleOwnerMessageStates.AsNoTracking().Where(s => s.PlotId == plotId && s.MessageId == messageId).ToListAsync(ct);
        var staged = context.ChangeTracker.Entries<ScheduleOwnerMessageState>()
            .Where(e => e.State == EntityState.Added && e.Entity.PlotId == plotId && e.Entity.MessageId == messageId)
            .Select(e => e.Entity);
        return saved.Concat(staged).OrderBy(s => s.AtUtc).ThenBy(s => s.Sequence).ToList();
    }

    public async Task<bool> FollowsChainAsync(Guid farmId, Guid plotId, Guid? cropCycleId, Guid chainId, CancellationToken ct = default)
    {
        var farm = new FarmId(farmId);

        // An Active choice of this plot (this season, when given) whose schedule version is in the chain.
        var subscriptions = await context.ScheduleSubscriptions.AsNoTracking()
            .Where(s => s.FarmId == farm && s.PlotId == plotId && s.State == ScheduleSubscriptionState.Active && (cropCycleId == null || s.CropCycleId == cropCycleId))
            .Select(s => s.ScheduleTemplateId)
            .ToListAsync(ct);
        if (subscriptions.Count > 0)
        {
            var versions = subscriptions.Select(v => v.Value).Distinct().ToList();
            if (await context.ScheduleTemplates.AsNoTracking().AnyAsync(t => versions.Contains(t.Id) && t.ChainId == chainId, ct))
            {
                return true;
            }
        }

        // An own work of this plot (season) whose origin is a take from a schedule of the chain.
        return await context.OwnScheduleItemOrigins.AsNoTracking()
            .AnyAsync(o => o.FarmId == farm && o.PlotId == plotId && (cropCycleId == null || o.CropCycleId == cropCycleId) && o.SourceChainId == chainId, ct);
    }

    public async Task<OwnScheduleItemRevision?> GetRevisionAsync(Guid itemId, int revisionNumber, CancellationToken ct = default) =>
        await context.OwnScheduleItemRevisions.AsNoTracking().FirstOrDefaultAsync(r => r.ItemId == itemId && r.RevisionNumber == revisionNumber, ct);

    public void Stage(ScheduleOwnerClip clip)
    {
        ArgumentNullException.ThrowIfNull(clip);
        context.ScheduleOwnerClips.Add(clip);
    }

    public void Stage(ScheduleOwnerMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        context.ScheduleOwnerMessages.Add(message);
    }

    public void Stage(ScheduleOwnerMessageState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        context.ScheduleOwnerMessageStates.Add(state);
    }

    /// <summary>The schedule chains these farms follow (an Active choice) or own copies from (an own work's origin), distinct.</summary>
    private async Task<HashSet<Guid>> ChainsOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct)
    {
        var farms = farmIds.Select(id => new FarmId(id)).ToList();
        var chains = new HashSet<Guid>();
        var versions = (await context.ScheduleSubscriptions.AsNoTracking()
                .Where(s => farms.Contains(s.FarmId) && s.State == ScheduleSubscriptionState.Active)
                .Select(s => s.ScheduleTemplateId)
                .ToListAsync(ct))
            .Select(v => v.Value).Distinct().ToList();
        if (versions.Count > 0)
        {
            foreach (var chain in await context.ScheduleTemplates.AsNoTracking().Where(t => versions.Contains(t.Id) && t.ChainId != null).Select(t => t.ChainId!.Value).Distinct().ToListAsync(ct))
            {
                chains.Add(chain);
            }
        }

        foreach (var chain in await context.OwnScheduleItemOrigins.AsNoTracking().Where(o => farms.Contains(o.FarmId) && o.SourceChainId != null).Select(o => o.SourceChainId!.Value).Distinct().ToListAsync(ct))
        {
            chains.Add(chain);
        }

        return chains;
    }
}
