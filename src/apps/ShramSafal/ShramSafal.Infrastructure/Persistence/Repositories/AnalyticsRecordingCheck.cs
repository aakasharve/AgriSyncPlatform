// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9, N1-C1 code half)
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>The last recording check, shared across requests for <see cref="AnalyticsRecordingRules.CacheFor"/>.</summary>
public sealed class AnalyticsRecordingCache
{
    private readonly object _gate = new();
    private DateTime _checkedAtUtc;
    private AnalyticsRecording? _state;

    /// <summary>The cached state when it was checked less than <see cref="AnalyticsRecordingRules.CacheFor"/> ago.</summary>
    public bool TryGet(DateTime nowUtc, out AnalyticsRecording state)
    {
        lock (_gate)
        {
            if (_state is { } cached && nowUtc >= _checkedAtUtc && nowUtc - _checkedAtUtc < AnalyticsRecordingRules.CacheFor)
            {
                state = cached;
                return true;
            }
        }

        state = AnalyticsRecording.Recording;
        return false;
    }

    public void Set(DateTime checkedAtUtc, AnalyticsRecording state)
    {
        lock (_gate)
        {
            _checkedAtUtc = checkedAtUtc;
            _state = state;
        }
    }
}

/// <summary>
/// The analytics recording check (<see cref="IAnalyticsRecordingCheck"/>): two reads, at most once a minute.
/// <list type="number">
/// <item>On the analytics connection, one statement: does the current UTC month's partition of <c>analytics.events</c>
/// exist (by the partition job's own name, <see cref="AnalyticsPartitionPlan"/>), and when was the newest
/// <c>log.created</c> written (a server-only event, indexed by type and time).</item>
/// <item>Through the audited cross-farm factory (one audit row naming the reader): the newest <c>ssf.daily_logs</c>
/// entry of the last 24 hours, across every farm.</item>
/// </list>
/// <see cref="AnalyticsRecordingRules.Decide"/> judges. A failed read escapes (the page answers 500), never "recording".
/// </summary>
internal sealed class AnalyticsRecordingCheck(
    AnalyticsDbContext analytics,
    IAdminDbContextFactory<ShramSafalDbContext> adminFactory,
    AnalyticsRecordingCache cache,
    TimeProvider? clock = null) : IAnalyticsRecordingCheck
{
    public async Task<AnalyticsRecording> CheckAsync(Guid readerUserId, CancellationToken ct)
    {
        var nowUtc = (clock ?? TimeProvider.System).GetUtcNow().UtcDateTime;
        if (cache.TryGet(nowUtc, out var cached))
        {
            return cached;
        }

        var partition = AnalyticsPartitionPlan.ForHorizon(DateOnly.FromDateTime(nowUtc), 0)[0].QualifiedName;
        bool partitionExists;
        DateTime? newestLogCreated;
        var conn = analytics.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT to_regclass(@partition) IS NOT NULL AS partition_exists,
                       (SELECT MAX(occurred_at_utc) FROM analytics.events WHERE event_type = 'log.created') AS newest_log_created
                """;
            var p = cmd.CreateParameter();
            p.ParameterName = "@partition";
            p.Value = partition;
            cmd.Parameters.Add(p);

            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct))
            {
                throw new InvalidOperationException("The analytics recording check returned no row; a SELECT of values always returns one.");
            }

            partitionExists = r.GetBoolean(0);
            newestLogCreated = r.IsDBNull(1) ? null : DateTime.SpecifyKind(r.GetDateTime(1), DateTimeKind.Utc);
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync();
        }

        DateTime? newestEntry;
        var since = nowUtc - AnalyticsRecordingRules.RecentEntryWindow;
        await using (var admin = await adminFactory.CreateAsync($"{nameof(AnalyticsRecordingCheck)}.newest-entry", readerUserId, ct))
        {
            newestEntry = await admin.DailyLogs
                .AsNoTracking()
                .Where(l => l.CreatedAtUtc >= since)
                .MaxAsync(l => (DateTime?)l.CreatedAtUtc, ct);
        }

        var state = AnalyticsRecordingRules.Decide(
            partitionExists,
            newestLogCreated,
            newestEntry is { } at ? DateTime.SpecifyKind(at, DateTimeKind.Utc) : null,
            nowUtc);
        cache.Set(nowUtc, state);
        return state;
    }
}
