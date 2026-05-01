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
            decimal? prior = weekRows.Count > 1 ? weekRows[^2].AvgWvfd : null;

            return new WvfdHistoryDto(
                CurrentWvfd: current,
                PriorWvfd: prior,
                GoalWvfd: 4.5m,
                Weeks: weekRows,
                TopFarms: farmRows);
        }
        catch { return new WvfdHistoryDto(0m, null, 4.5m, [], []); }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    // ── Phase 4: Farms ──────────────────────────────────────────────────────
    public async Task<FarmsListDto> GetFarmsListAsync(
        int page, int pageSize, string? search, string? tier, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            var fs = !string.IsNullOrWhiteSpace(search);
            var ft = !string.IsNullOrWhiteSpace(tier);
            using var countCmd = conn.CreateCommand();
            countCmd.CommandText = "SELECT COUNT(DISTINCT f.farm_id) FROM ssf.farms f" +
                (fs ? " WHERE LOWER(f.name) LIKE LOWER(@s)" : "");
            if (fs) AddParam(countCmd, "@s", $"%{search}%");
            var rawCount = await countCmd.ExecuteScalarAsync(ct);
            int total = rawCount is long l ? (int)l : rawCount is int i ? i : 0;

            var items = new List<FarmSummaryDto>();
            using var dataCmd = conn.CreateCommand();
            var where = new System.Text.StringBuilder("WHERE 1=1");
            if (fs) where.Append(" AND LOWER(f.name) LIKE LOWER(@s2)");
            if (ft) where.Append(" AND w.engagement_tier = @tier");
            dataCmd.CommandText = $"""
                SELECT f.farm_id, f.name,
                    COALESCE(u.phone, '—'),
                    'trial',
                    w.wvfd, w.engagement_tier,
                    COALESCE(e.errors_24h, 0),
                    f.last_log_at, f.created_at
                FROM ssf.farms f
                LEFT JOIN ssf.farm_memberships fm ON fm.farm_id = f.farm_id AND fm.role = 'owner'
                LEFT JOIN public.users u ON u.user_id = fm.user_id
                LEFT JOIN mis.wvfd_weekly w ON w.farm_id = f.farm_id
                    AND w.week_start = (SELECT MAX(week_start) FROM mis.wvfd_weekly)
                LEFT JOIN (
                    SELECT farm_id, COUNT(*) AS errors_24h
                    FROM analytics.events
                    WHERE event_type IN ('api.error','client.error')
                      AND occurred_at_utc >= NOW() - INTERVAL '24 hours'
                      AND farm_id IS NOT NULL
                    GROUP BY farm_id
                ) e ON e.farm_id = f.farm_id
                {where}
                ORDER BY COALESCE(w.wvfd,-1) DESC, f.created_at DESC
                LIMIT @size OFFSET @offset
                """;
            if (fs) AddParam(dataCmd, "@s2", $"%{search}%");
            if (ft) AddParam(dataCmd, "@tier", tier!);
            AddParam(dataCmd, "@size", pageSize);
            AddParam(dataCmd, "@offset", (page - 1) * pageSize);
            using var r = await dataCmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(new FarmSummaryDto(r.GetGuid(0), r.GetString(1),
                    r.IsDBNull(2) ? "—" : r.GetString(2),
                    r.GetString(3),
                    r.IsDBNull(4) ? null : r.GetDecimal(4),
                    r.IsDBNull(5) ? null : r.GetString(5),
                    r.GetInt32(6),
                    r.IsDBNull(7) ? null : r.GetDateTime(7),
                    r.GetDateTime(8)));
            return new FarmsListDto(items, total, page, pageSize);
        }
        catch { return new FarmsListDto([], 0, page, pageSize); }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    /// <summary>
    /// Returns the silent-churn watchlist for admins.
    ///
    /// <para>
    /// Reads <c>mis.silent_churn_watchlist</c>, the matview that joins
    /// <c>mis.subscription_farms</c> (denormalised cross-aggregate
    /// projection per ADR-0004 α) with <c>analytics.events</c> to
    /// surface farms whose subscriptions are still active but have not
    /// produced a <c>log.created</c> event in the last 14 days.
    /// </para>
    ///
    /// <para>
    /// Restored on 2026-05-01 by T-IGH-03-MIS-MATVIEW-REDESIGN Bucket 1
    /// (migration <c>20260502010000_AddSubscriptionFarmsAndChurnMatviews</c>).
    /// Falls back to an empty list if the matview is empty or if the
    /// query throws — same graceful pattern as the other Get* methods.
    /// </para>
    /// </summary>
    public async Task<IReadOnlyList<SilentChurnItemDto>> GetSilentChurnAsync(CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            var items = new List<SilentChurnItemDto>();
            using var cmd = conn.CreateCommand();
            // Join the matview with ssf.farms (for canonical farm name as
            // a fallback) and public.users (for the primary owner's
            // phone via owner_account_memberships → user). Days_since_last_log
            // is rendered as ceil(days/7) weeks for the dashboard.
            cmd.CommandText = """
                SELECT
                    s.farm_id,
                    COALESCE(s.farm_name, 'Unknown')        AS name,
                    COALESCE(u.phone, '—')                  AS owner_phone,
                    COALESCE(s.plan_code, 'trial')          AS plan,
                    GREATEST(1, (s.days_since_last_log / 7)) AS weeks_silent,
                    s.last_log_at
                FROM mis.silent_churn_watchlist s
                LEFT JOIN accounts.owner_accounts oa
                    ON oa.owner_account_id = s.owner_account_id
                LEFT JOIN public.users u
                    ON u."Id" = oa.primary_owner_user_id
                ORDER BY s.days_since_last_log DESC
                LIMIT 50
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(new SilentChurnItemDto(
                    FarmId:     r.GetGuid(0),
                    Name:       r.GetString(1),
                    OwnerPhone: r.IsDBNull(2) ? "—" : r.GetString(2),
                    Plan:       r.GetString(3),
                    WeeksSilent: r.GetInt32(4),
                    LastLogAt:  r.IsDBNull(5) ? null : r.GetDateTime(5)));
            return items;
        }
        catch { return []; }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    public async Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            var items = new List<SufferingItemDto>();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT s.farm_id, COALESCE(f.name, s.farm_id::text),
                    s.error_count, s.sync_errors, s.log_errors, s.voice_errors, s.last_error_at
                FROM mis.farmer_suffering_watchlist s
                LEFT JOIN ssf.farms f ON f.farm_id = s.farm_id
                ORDER BY s.error_count DESC LIMIT 50
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(new SufferingItemDto(r.GetGuid(0), r.GetString(1),
                    r.GetInt32(2), r.GetInt32(3), r.GetInt32(4), r.GetInt32(5), r.GetDateTime(6)));
            return items;
        }
        catch { return []; }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    // ── Phase 5: Users ──────────────────────────────────────────────────────
    public async Task<UsersListDto> GetUsersListAsync(
        int page, int pageSize, string? search, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            var fs = !string.IsNullOrWhiteSpace(search);
            using var countCmd = conn.CreateCommand();
            countCmd.CommandText = "SELECT COUNT(*) FROM public.users u" +
                (fs ? " WHERE u.phone LIKE @s OR LOWER(u.display_name) LIKE LOWER(@s)" : "");
            if (fs) AddParam(countCmd, "@s", $"%{search}%");
            var rawCount = await countCmd.ExecuteScalarAsync(ct);
            int total = rawCount is long l ? (int)l : rawCount is int i ? i : 0;

            var items = new List<UserSummaryDto>();
            using var dataCmd = conn.CreateCommand();
            dataCmd.CommandText =
                "SELECT u.user_id, u.phone, u.display_name, u.email," +
                " u.created_at, u.last_login_at" +
                " FROM public.users u" +
                (fs ? " WHERE u.phone LIKE @s2 OR LOWER(u.display_name) LIKE LOWER(@s2)" : "") +
                " ORDER BY u.created_at DESC LIMIT @size OFFSET @offset";
            if (fs) AddParam(dataCmd, "@s2", $"%{search}%");
            AddParam(dataCmd, "@size", pageSize);
            AddParam(dataCmd, "@offset", (page - 1) * pageSize);
            using var r = await dataCmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(new UserSummaryDto(r.GetGuid(0), r.GetString(1),
                    r.IsDBNull(2) ? null : r.GetString(2),
                    r.IsDBNull(3) ? null : r.GetString(3),
                    [],
                    r.GetDateTime(4),
                    r.IsDBNull(5) ? null : r.GetDateTime(5)));
            return new UsersListDto(items, total, page, pageSize);
        }
        catch { return new UsersListDto([], 0, page, pageSize); }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    private static void AddParam(System.Data.IDbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
