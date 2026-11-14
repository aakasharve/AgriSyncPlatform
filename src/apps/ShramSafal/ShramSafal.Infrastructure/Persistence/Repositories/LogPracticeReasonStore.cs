using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 lane CMP-D3 (founder D-68 round 2) - EF Core implementation of <see cref="ILogPracticeReasonStore"/>. Shares the scoped
/// <see cref="ShramSafalDbContext"/>, so a staged reason is committed by the caller's one save with its audit row. Every read is untracked and
/// runs under the caller's farm scope (row-level security).
/// </summary>
internal sealed class LogPracticeReasonStore(ShramSafalDbContext context) : ILogPracticeReasonStore
{
    public void Stage(LogPracticeReason reason)
    {
        ArgumentNullException.ThrowIfNull(reason);
        context.LogPracticeReasons.Add(reason);
    }

    public Task<LogPracticeReason?> GetByIdAsync(Guid reasonId, CancellationToken ct = default) =>
        context.LogPracticeReasons.AsNoTracking().FirstOrDefaultAsync(r => r.Id == reasonId, ct);

    public Task<LogPracticeReason?> GetLatestAsync(Guid dailyLogId, string workKey, CancellationToken ct = default) =>
        context.LogPracticeReasons
            .AsNoTracking()
            .Where(r => r.DailyLogId == dailyLogId && r.WorkKey == workKey)
            .OrderByDescending(r => r.CreatedAtUtc)
            .ThenByDescending(r => r.Id)
            .FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<LogPracticeReason>> GetForLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(dailyLogIds);
        if (dailyLogIds.Count == 0)
        {
            return [];
        }

        // P003: the LATEST row per (record, item) is picked inside the database, in this ONE command, so the read never grows with a record's history.
        // The one rule (also the supersede rule): newest created_at_utc first, then the larger id.
        var ids = dailyLogIds.ToArray();
        return await context.LogPracticeReasons
            .FromSqlRaw(
                @"SELECT DISTINCT ON (daily_log_id, work_key) *
                  FROM ssf.log_practice_reasons
                  WHERE daily_log_id = ANY({0})
                  ORDER BY daily_log_id, work_key, created_at_utc DESC, ""Id"" DESC",
                ids)
            .AsNoTracking()
            .ToListAsync(ct);
    }
}
