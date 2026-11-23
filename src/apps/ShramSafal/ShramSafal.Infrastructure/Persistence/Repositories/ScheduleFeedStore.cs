using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 schedule slice 5 - EF Core implementation of <see cref="IScheduleFeedStore"/>. Shares the scoped <see cref="ShramSafalDbContext"/>, so a staged answer
/// and the plans it moves are committed by the caller's one save.
/// </summary>
internal sealed class ScheduleFeedStore(ShramSafalDbContext context) : IScheduleFeedStore
{
    public async Task<IReadOnlyList<PlannedWork>> GetPlansOfItemsAsync(IReadOnlyCollection<Guid> ownItemIds, CancellationToken ct = default)
    {
        if (ownItemIds.Count == 0)
        {
            return [];
        }

        var ids = ownItemIds.Select(id => (Guid?)id).ToList();
        return await context.PlannedWork
            .Include(w => w.Plots)
            .Where(w => w.OwnItemId != null && ids.Contains(w.OwnItemId))
            .OrderBy(w => w.OwnItemId)
            .ThenBy(w => w.Occurrence)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<PlannedWork>> GetSchedulePlansLinkingLogAsync(Guid dailyLogId, CancellationToken ct = default)
    {
        if (dailyLogId == Guid.Empty)
        {
            return [];
        }

        // The linked ids are converted arrays (as in ShramSafalRepository's linking read), so the match is made in SQL on the two columns, under the farm's
        // row security, and the plans are then read tracked with their plot rows.
        var ids = await context.Database
            .SqlQuery<Guid>($"""
                SELECT w.id AS "Value" FROM ssf.planned_work w
                WHERE w.own_item_id IS NOT NULL
                  AND ({dailyLogId} = ANY (w.linked_daily_log_ids)
                       OR EXISTS (SELECT 1 FROM ssf.planned_work_plots p
                                  WHERE p.planned_work_id = w.id AND {dailyLogId} = ANY (p.linked_daily_log_ids)))
                """)
            .ToListAsync(ct);
        if (ids.Count == 0)
        {
            return [];
        }

        return await context.PlannedWork.Include(w => w.Plots).Where(w => ids.Contains(w.Id)).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<ScheduleTaskEvent>> GetEventsAsync(Guid plotId, Guid cropCycleId, CancellationToken ct = default)
    {
        var saved = await context.ScheduleTaskEvents
            .AsNoTracking()
            .Where(e => e.PlotId == plotId && e.CropCycleId == cropCycleId)
            .ToListAsync(ct);
        var staged = context.ChangeTracker.Entries<ScheduleTaskEvent>()
            .Where(e => e.State == EntityState.Added && e.Entity.PlotId == plotId && e.Entity.CropCycleId == cropCycleId)
            .Select(e => e.Entity);
        return saved
            .Concat(staged.Where(s => saved.All(x => x.Id != s.Id)))
            .OrderBy(e => e.RecordedAtUtc)
            .ThenBy(e => e.Id)
            .ToList();
    }

    public async Task<ScheduleTaskEvent?> GetEventAsync(Guid eventId, CancellationToken ct = default) =>
        eventId == Guid.Empty ? null : await context.ScheduleTaskEvents.AsNoTracking().FirstOrDefaultAsync(e => e.Id == eventId, ct);

    public void Stage(ScheduleTaskEvent taskEvent)
    {
        ArgumentNullException.ThrowIfNull(taskEvent);
        context.ScheduleTaskEvents.Add(taskEvent);
    }
}
