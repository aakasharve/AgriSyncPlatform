using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 lane ATT-W (R29) - EF Core implementation of <see cref="IScheduleStepMoveStore"/>. Shares the scoped
/// <see cref="ShramSafalDbContext"/>, so a staged move is committed by the caller's one save with its audit row.
/// </summary>
internal sealed class ScheduleStepMoveStore(ShramSafalDbContext context) : IScheduleStepMoveStore
{
    public void Stage(ScheduleStepMove move)
    {
        ArgumentNullException.ThrowIfNull(move);
        context.ScheduleStepMoves.Add(move);
    }

    public async Task<IReadOnlyList<ScheduleStepMove>> GetForSubscriptionsAsync(
        IReadOnlyCollection<Guid> subscriptionIds, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(subscriptionIds);
        if (subscriptionIds.Count == 0)
        {
            return [];
        }

        var ids = subscriptionIds.ToList();
        return await context.ScheduleStepMoves
            .AsNoTracking()
            .Where(m => ids.Contains(m.ScheduleSubscriptionId))
            .OrderBy(m => m.MovedAtUtc)
            .ThenBy(m => m.Id)
            .ToListAsync(ct);
    }
}
