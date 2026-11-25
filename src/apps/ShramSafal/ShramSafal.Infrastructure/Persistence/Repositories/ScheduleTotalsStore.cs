using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 schedule slice 13 - EF Core implementation of <see cref="IScheduleTotalsStore"/>. The totals are read through the ONE SECURITY DEFINER function
/// <c>ssf.schedule_chain_totals</c> (migration <c>AddScheduleTotals</c>), which returns aggregates only; the request's own row security is untouched and no farm's row is read here.
/// </summary>
internal sealed class ScheduleTotalsStore(ShramSafalDbContext context) : IScheduleTotalsStore
{
    public async Task<IReadOnlyList<ScheduleTotalsRow>> GetTotalsAsync(Guid chainKey, IReadOnlyCollection<string> taskKeys, CancellationToken ct = default)
    {
        var keys = taskKeys.ToArray();
        var rows = await context.Database
            .SqlQuery<TotalsRaw>($"SELECT metric AS \"Metric\", task_key AS \"TaskKey\", farmers AS \"Farmers\", amount AS \"Amount\" FROM ssf.schedule_chain_totals({chainKey}, {keys})")
            .ToListAsync(ct);
        return rows.Select(r => new ScheduleTotalsRow(r.Metric, r.TaskKey, r.Farmers, r.Amount)).ToList();
    }

    public async Task<IReadOnlyList<ScheduleChainVersion>> GetChainVersionsAsync(Guid chainKey, CancellationToken ct = default) =>
        await context.ScheduleTemplates.AsNoTracking()
            .Where(t => t.ChainId == chainKey || (t.ChainId == null && t.Id == chainKey))
            .OrderBy(t => t.Version)
            .Select(t => new ScheduleChainVersion(t.Id, t.Version))
            .ToListAsync(ct);

    private sealed class TotalsRaw
    {
        public string Metric { get; set; } = string.Empty;
        public string? TaskKey { get; set; }
        public int Farmers { get; set; }
        public int Amount { get; set; }
    }
}
