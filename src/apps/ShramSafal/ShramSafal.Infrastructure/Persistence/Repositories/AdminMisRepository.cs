using AgriSync.BuildingBlocks.Analytics;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// Reads mis.wvfd_weekly (and related materialized views) for the admin
/// metrics endpoints. All queries are read-only against AnalyticsDbContext.
/// Graceful empty-return if views not yet populated.
/// </summary>
public sealed class AdminMisRepository(AnalyticsDbContext analyticsContext) : IAdminMisRepository
{
    public async Task<WvfdHistoryDto> GetWvfdHistoryAsync(int weeks, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);

        try
        {
            // 1. Weekly aggregated WVFD trend (avg across all farms per week)
            var weekRows = new List<WvfdWeekDto>();
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = $"""
                    SELECT
                        week_start::date,
                        ROUND(AVG(wvfd)::numeric, 2) AS avg_wvfd,
                        COUNT(DISTINCT farm_id)      AS active_farms
                    FROM mis.wvfd_weekly
                    WHERE week_start >= CURRENT_DATE - INTERVAL '{weeks * 7} days'
                    GROUP BY week_start
                    ORDER BY week_start ASC
                    """;
                using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct))
                    weekRows.Add(new WvfdWeekDto(
                        DateOnly.FromDateTime(r.GetDateTime(0)),
                        r.GetDecimal(1),
                        (int)r.GetInt64(2)));
            }

            // 2. Per-farm breakdown (most recent week)
            var farmRows = new List<WvfdFarmRowDto>();
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = """
                    SELECT
                        w.farm_id,
                        ROUND(w.wvfd::numeric, 2)  AS wvfd,
                        COALESCE(w.engagement_tier, 'D') AS tier
                    FROM mis.wvfd_weekly w
                    WHERE w.week_start = (SELECT MAX(week_start) FROM mis.wvfd_weekly)
                    ORDER BY w.wvfd DESC
                    LIMIT 50
                    """;
                using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct))
                    farmRows.Add(new WvfdFarmRowDto(
                        FarmId: r.GetGuid(0),
                        Wvfd: r.GetDecimal(1),
                        EngagementTier: r.GetString(2),
                        ActiveFarms: 0));
            }

            decimal current = weekRows.Count > 0 ? weekRows[^1].AvgWvfd : 0m;
            decimal? prior  = weekRows.Count > 1 ? weekRows[^2].AvgWvfd : null;

            return new WvfdHistoryDto(
                CurrentWvfd: current,
                PriorWvfd:   prior,
                GoalWvfd:    4.5m,
                Weeks:       weekRows,
                TopFarms:    farmRows);
        }
        catch { return new WvfdHistoryDto(0m, null, 4.5m, [], []); }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }
}
