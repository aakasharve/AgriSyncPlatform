using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// Reads mis.wvfd_weekly (and related materialized views) for the admin
/// metrics endpoints. All queries are read-only.
///
/// <para>
/// The WVFD, silent-churn and suffering reads keep their older graceful
/// empty-return. The farms and users lists do NOT (spec
/// company-mis-real-numbers-2026-11-15): a failed read escapes and answers 500.
/// </para>
///
/// <para>
/// <paramref name="adminDbFactory"/> is needed only by the farms list, the
/// cross-farm read here. It is optional so code that builds this repository by
/// hand for the analytics queries keeps working; the container always supplies
/// it (<c>AddShramSafalInfrastructure</c> registers the factory).
/// </para>
/// </summary>
public sealed class AdminMisRepository(
    AnalyticsDbContext analyticsContext,
    IAdminDbContextFactory<ShramSafalDbContext>? adminDbFactory = null) : IAdminMisRepository
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
    // spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 4). ssf.farms and ssf.daily_logs are under
    // FORCED row-level security, so the farm rows are read through the audited cross-farm factory (one
    // admin_cross_tenant audit row naming the admin per page load). Phones, the weekly score and the error count
    // come from the analytics connection (no row-level security on those). Nothing is caught: a failed read
    // answers 500, never an empty list. Plan is always null (no made-up "trial").
    public async Task<FarmsListDto> GetFarmsListAsync(
        Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default)
    {
        if (adminDbFactory is null)
        {
            throw new InvalidOperationException(
                $"{nameof(AdminMisRepository)} was built without an admin DbContext factory, so it cannot "
                + "read farms across farms. Resolve it from the container.");
        }

        var hasSearch = !string.IsNullOrWhiteSpace(search);
        var hasTier = !string.IsNullOrWhiteSpace(tier);

        // The tier filter is applied to the farm query BEFORE paging.
        List<FarmId>? tierFarmIds = null;
        if (hasTier)
        {
            tierFarmIds = (await ReadFarmIdsOfTierAsync(tier!, ct)).Select(id => new FarmId(id)).ToList();
        }

        await using var ssf = await adminDbFactory.CreateAsync(
            reason: $"{nameof(AdminMisRepository)}.farms-list",
            actorUserId: adminUserId,
            ct: ct);

        // Forced row-level security hides every row WITHOUT an error when the connection is not privileged.
        // With no filter, "this context sees no farm at all" is treated as that failure, not as "no farms".
        if (!hasSearch && !hasTier && !await ssf.Farms.AsNoTracking().AnyAsync(ct))
        {
            throw new InvalidOperationException(
                "The admin context can see no farm at all. ssf.farms is under forced row-level security, "
                + "which returns zero rows without an error to a connection that is not privileged; "
                + "refusing to answer that there are no farms.");
        }

        var query = ssf.Farms.AsNoTracking();
        if (hasSearch)
        {
            // % and _ in the search text match literally (escaped with a backslash).
            var pattern = "%" + EscapeLike(search!.Trim()) + "%";
            query = query.Where(f => EF.Functions.ILike(f.Name, pattern, LikeEscape));
        }

        if (tierFarmIds is not null)
        {
            query = query.Where(f => tierFarmIds.Contains(f.Id));
        }

        var total = await query.CountAsync(ct);

        var farms = await query
            .OrderByDescending(f => f.CreatedAtUtc)
            .ThenBy(f => f.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(f => new
            {
                FarmId = (Guid)f.Id,
                f.Name,
                OwnerUserId = (Guid)f.OwnerUserId,
                f.CreatedAtUtc,
                LastLogAt = ssf.DailyLogs.Where(l => l.FarmId == f.Id).Max(l => (DateTime?)l.CreatedAtUtc),
            })
            .ToListAsync(ct);

        if (farms.Count == 0)
        {
            return new FarmsListDto([], total, page, pageSize);
        }

        var farmIds = farms.Select(f => f.FarmId).ToArray();
        var phones = await ReadPhonesAsync(farms.Select(f => f.OwnerUserId).Distinct().ToArray(), ct);
        var scores = await ReadLatestWvfdAsync(farmIds, ct);
        var errors = await ReadErrors24hAsync(farmIds, ct);

        var items = farms
            .Select(f => new FarmSummaryDto(
                FarmId: f.FarmId,
                Name: f.Name,
                OwnerPhone: phones.TryGetValue(f.OwnerUserId, out var phone) && !string.IsNullOrEmpty(phone) ? phone : "—",
                Plan: null,
                Wvfd7d: scores.TryGetValue(f.FarmId, out var score) ? score.Wvfd : null,
                EngagementTier: scores.TryGetValue(f.FarmId, out var tierRow) ? tierRow.Tier : null,
                Errors24h: errors.GetValueOrDefault(f.FarmId),
                LastLogAt: f.LastLogAt,
                CreatedAt: f.CreatedAtUtc))
            .ToList();

        return new FarmsListDto(items, total, page, pageSize);
    }

    /// <summary>Farm ids of the given engagement tier in the latest mis.wvfd_weekly week.</summary>
    private async Task<List<Guid>> ReadFarmIdsOfTierAsync(string tier, CancellationToken ct)
    {
        var ids = new List<Guid>();
        await WithAnalyticsConnectionAsync(async conn =>
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT w.farm_id
                FROM mis.wvfd_weekly w
                WHERE w.week_start = (SELECT MAX(week_start) FROM mis.wvfd_weekly)
                  AND w.engagement_tier = @tier
                """;
            AddParam(cmd, "@tier", tier.Trim());
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) ids.Add(r.GetGuid(0));
        }, ct);
        return ids;
    }

    private async Task<Dictionary<Guid, string?>> ReadPhonesAsync(Guid[] userIds, CancellationToken ct)
    {
        var phones = new Dictionary<Guid, string?>();
        await WithAnalyticsConnectionAsync(async conn =>
        {
            using var cmd = conn.CreateCommand();
            // public.users: key column "Id" (EF default, quoted); the phone is the owned column "phone".
            cmd.CommandText = """
                SELECT u."Id", u.phone
                FROM public.users u
                WHERE u."Id" = ANY(@ids)
                """;
            AddParam(cmd, "@ids", userIds);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) phones[r.GetGuid(0)] = r.IsDBNull(1) ? null : r.GetString(1);
        }, ct);
        return phones;
    }

    /// <summary>The latest week's score and tier per farm; a farm with no row there gets nulls.</summary>
    private async Task<Dictionary<Guid, (decimal? Wvfd, string? Tier)>> ReadLatestWvfdAsync(Guid[] farmIds, CancellationToken ct)
    {
        var scores = new Dictionary<Guid, (decimal? Wvfd, string? Tier)>();
        await WithAnalyticsConnectionAsync(async conn =>
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT w.farm_id, ROUND(w.wvfd::numeric, 2), w.engagement_tier
                FROM mis.wvfd_weekly w
                WHERE w.week_start = (SELECT MAX(week_start) FROM mis.wvfd_weekly)
                  AND w.farm_id = ANY(@ids)
                """;
            AddParam(cmd, "@ids", farmIds);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                scores[r.GetGuid(0)] = (r.IsDBNull(1) ? null : r.GetDecimal(1), r.IsDBNull(2) ? null : r.GetString(2));
        }, ct);
        return scores;
    }

    private async Task<Dictionary<Guid, int>> ReadErrors24hAsync(Guid[] farmIds, CancellationToken ct)
    {
        var errors = new Dictionary<Guid, int>();
        await WithAnalyticsConnectionAsync(async conn =>
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT e.farm_id, COUNT(*)
                FROM analytics.events e
                WHERE e.event_type IN ('api.error','client.error')
                  AND e.occurred_at_utc >= NOW() - INTERVAL '24 hours'
                  AND e.farm_id = ANY(@ids)
                GROUP BY e.farm_id
                """;
            AddParam(cmd, "@ids", farmIds);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) errors[r.GetGuid(0)] = (int)r.GetInt64(1);
        }, ct);
        return errors;
    }

    private async Task WithAnalyticsConnectionAsync(Func<System.Data.Common.DbConnection, Task> work, CancellationToken ct)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try { await work(conn); }
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
    ///
    /// <para>
    /// <b>FM-empty caveat (Path C, accepted 2026-05-03):</b>
    /// <c>mis.silent_churn_watchlist</c> depends on
    /// <c>mis.subscription_farms</c>, which joins via
    /// <c>ssf.farm_memberships</c>. That table is currently empty in
    /// production — <c>ssf.farm_memberships</c> will be populated
    /// naturally once DWC v2 Phase E ships the worker-capture flow.
    /// Until then this method returns <c>[]</c> on prod. No engineering
    /// action required; see T-BUCKET1-CHURN-FM-EMPTY for the full
    /// decision record.
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
                    FarmId: r.GetGuid(0),
                    Name: r.GetString(1),
                    OwnerPhone: r.IsDBNull(2) ? "—" : r.GetString(2),
                    Plan: r.GetString(3),
                    WeeksSilent: r.GetInt32(4),
                    LastLogAt: r.IsDBNull(5) ? null : r.GetDateTime(5)));
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
    // spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 4). Real columns of public.users ("Id", phone,
    // display_name, created_at_utc); last sign-in = the latest refresh-token issue or use. Email is not stored
    // (null); Apps is empty. Nothing is caught: a failed read answers 500, never an empty list.
    public async Task<UsersListDto> GetUsersListAsync(
        int page, int pageSize, string? search, CancellationToken ct = default)
    {
        var fs = !string.IsNullOrWhiteSpace(search);
        var total = 0;
        var items = new List<UserSummaryDto>();

        await WithAnalyticsConnectionAsync(async conn =>
        {
            using (var countCmd = conn.CreateCommand())
            {
                countCmd.CommandText = "SELECT COUNT(*) FROM public.users u" +
                    (fs ? $" WHERE u.phone LIKE @s ESCAPE '{LikeEscape}' OR LOWER(u.display_name) LIKE LOWER(@s) ESCAPE '{LikeEscape}'" : "");
                if (fs) AddParam(countCmd, "@s", $"%{EscapeLike(search!)}%");
                var rawCount = await countCmd.ExecuteScalarAsync(ct);
                total = Convert.ToInt32(rawCount, System.Globalization.CultureInfo.InvariantCulture);
            }

            using var dataCmd = conn.CreateCommand();
            dataCmd.CommandText = """
                SELECT u."Id", u.phone, u.display_name, u.created_at_utc,
                       GREATEST(MAX(t.created_at_utc), MAX(t.last_used_at_utc)) AS last_sign_in
                FROM public.users u
                LEFT JOIN public.refresh_tokens t ON t.user_id = u."Id"
                """ +
                (fs ? $" WHERE u.phone LIKE @s2 ESCAPE '{LikeEscape}' OR LOWER(u.display_name) LIKE LOWER(@s2) ESCAPE '{LikeEscape}'" : "") +
                """

                GROUP BY u."Id"
                ORDER BY u.created_at_utc DESC, u."Id"
                LIMIT @size OFFSET @offset
                """;
            if (fs) AddParam(dataCmd, "@s2", $"%{EscapeLike(search!)}%");
            AddParam(dataCmd, "@size", pageSize);
            AddParam(dataCmd, "@offset", (page - 1) * pageSize);
            using var r = await dataCmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(new UserSummaryDto(
                    UserId: r.GetGuid(0),
                    Phone: r.IsDBNull(1) ? "—" : r.GetString(1),
                    DisplayName: r.IsDBNull(2) ? null : r.GetString(2),
                    Email: null,
                    Apps: [],
                    CreatedAt: r.GetDateTime(3),
                    LastLoginAt: r.IsDBNull(4) ? null : r.GetDateTime(4)));
        }, ct);

        return new UsersListDto(items, total, page, pageSize);
    }

    /// <summary>The LIKE escape character used by both lists' search.</summary>
    private const string LikeEscape = "\\";

    /// <summary>Makes the escape character, % and _ in user search text match literally.</summary>
    private static string EscapeLike(string text) =>
        text.Replace(LikeEscape, LikeEscape + LikeEscape, StringComparison.Ordinal)
            .Replace("%", LikeEscape + "%", StringComparison.Ordinal)
            .Replace("_", LikeEscape + "_", StringComparison.Ordinal);

    private static void AddParam(System.Data.IDbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
