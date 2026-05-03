using AgriSync.BuildingBlocks.Analytics;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using System.Data.Common;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// Mode B cohort dashboard reader. Aggregates DWC v2 metrics across
/// every farm in the caller's <see cref="AdminScope"/> for the current
/// ISO week — score distribution, intervention queue, watchlist,
/// engagement tier breakdown, pillar heatmap, 8-week trend, and the
/// reused farmer-suffering top-10.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.5 Step 2. Every read filters via
/// <c>JOIN mis.effective_org_farm_scope efs</c> (Platform admins skip
/// the JOIN) so cohort numbers reflect only the farms the caller is
/// allowed to see. All collection caps are enforced at the SQL level
/// to keep the response under the §3.9 1500ms p95 budget.
/// </para>
/// </remarks>
public sealed class AdminCohortPatternsRepository(AnalyticsDbContext analyticsContext) : IAdminCohortPatternsRepository
{
    public async Task<CohortPatternsDto> GetAsync(AdminScope scope, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);

        try
        {
            var distribution = await GetScoreDistributionAsync(conn, scope, ct);
            var intervention = await GetBucketAsync(conn, scope, "intervention", limit: 50, ct);
            var watchlist    = await GetBucketAsync(conn, scope, "watchlist",    limit: 100, ct);
            var tiers        = await GetEngagementTierAsync(conn, scope, ct);
            var heatmap      = await GetPillarHeatmapAsync(conn, scope, ct);
            var trend        = await GetWeeklyTrendAsync(conn, scope, ct);
            var suffering    = await GetSufferingTop10Async(conn, scope, ct);

            return new CohortPatternsDto(
                ScoreDistribution: distribution,
                InterventionQueue: intervention,
                Watchlist: watchlist,
                EngagementTierBreakdown: tiers,
                PillarHeatmap: heatmap,
                TrendByWeek: trend,
                FarmerSufferingTop10: suffering);
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync();
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /// <summary>
    /// Renders the optional <c>JOIN mis.effective_org_farm_scope</c>
    /// fragment + the matching <c>WHERE efs.org_id = @org</c> filter for
    /// non-Platform callers. Platform admins get an empty fragment so
    /// they see every farm without an explicit grant in the projection
    /// table (matches the EntitlementResolver Platform special-case).
    /// </summary>
    private static (string Join, string Where) ScopeJoin(AdminScope scope, string farmCol)
    {
        if (scope.IsPlatformAdmin) return ("", "");
        return (
            $"JOIN mis.effective_org_farm_scope efs ON efs.farm_id = {farmCol}",
            "AND efs.org_id = @org");
    }

    private static async Task<IReadOnlyList<CohortScoreBinDto>> GetScoreDistributionAsync(
        DbConnection conn, AdminScope scope, CancellationToken ct)
    {
        // 10-bin histogram covering 0..100. We always emit all 10 bins
        // (zero-filled) so the chart shape is stable.
        var bins = new[] { "0-10","11-20","21-30","31-40","41-50","51-60","61-70","71-80","81-90","91-100" };
        var counts = new int[10];

        try
        {
            var (join, where) = ScopeJoin(scope, "d.farm_id");
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                SELECT
                    LEAST(9, GREATEST(0, FLOOR(d.score / 10.0)::int)) AS bin,
                    COUNT(*) AS n
                FROM mis.dwc_score_per_farm_week d
                {join}
                WHERE d.week_start = (SELECT MAX(week_start) FROM mis.dwc_score_per_farm_week)
                  {where}
                GROUP BY bin
                """;
            if (!scope.IsPlatformAdmin) AddParam(cmd, "@org", scope.OrganizationId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var idx = r.GetInt32(0);
                if (idx >= 0 && idx < 10) counts[idx] = (int)r.GetInt64(1);
            }
        }
        catch { /* graceful empty histogram */ }

        var rows = new List<CohortScoreBinDto>(10);
        for (int i = 0; i < 10; i++) rows.Add(new CohortScoreBinDto(bins[i], counts[i]));
        return rows;
    }

    private static async Task<IReadOnlyList<CohortBucketDto>> GetBucketAsync(
        DbConnection conn, AdminScope scope, string bucket, int limit, CancellationToken ct)
    {
        var rows = new List<CohortBucketDto>(limit);
        try
        {
            var (join, where) = ScopeJoin(scope, "d.farm_id");
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                WITH curr AS (
                    SELECT d.farm_id, d.score
                    FROM mis.dwc_score_per_farm_week d
                    {join}
                    WHERE d.bucket = @bucket
                      AND d.week_start = (SELECT MAX(week_start) FROM mis.dwc_score_per_farm_week)
                      {where}
                ),
                prev AS (
                    SELECT d.farm_id, d.score AS prev_score
                    FROM mis.dwc_score_per_farm_week d
                    WHERE d.week_start = (
                        SELECT week_start FROM mis.dwc_score_per_farm_week
                        WHERE week_start < (SELECT MAX(week_start) FROM mis.dwc_score_per_farm_week)
                        ORDER BY week_start DESC LIMIT 1
                    )
                )
                SELECT
                    c.farm_id,
                    COALESCE(f.name, '—') AS farmer_name,
                    c.score,
                    (c.score - COALESCE(p.prev_score, c.score)) AS weekly_delta,
                    COALESCE(la.last_active, NOW() - INTERVAL '30 days') AS last_active
                FROM curr c
                LEFT JOIN prev p ON p.farm_id = c.farm_id
                LEFT JOIN ssf.farms f ON f."Id" = c.farm_id
                LEFT JOIN (
                    SELECT farm_id, MAX(occurred_at_utc) AS last_active
                    FROM analytics.events
                    WHERE event_type = 'log.created' AND farm_id IS NOT NULL
                    GROUP BY farm_id
                ) la ON la.farm_id = c.farm_id
                ORDER BY c.score ASC
                LIMIT @lim
                """;
            AddParam(cmd, "@bucket", bucket);
            AddParam(cmd, "@lim", limit);
            if (!scope.IsPlatformAdmin) AddParam(cmd, "@org", scope.OrganizationId);

            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                rows.Add(new CohortBucketDto(
                    FarmId: r.GetGuid(0),
                    FarmerName: r.GetString(1),
                    Score: r.GetInt32(2),
                    WeeklyDelta: r.GetInt32(3),
                    LastActiveAt: r.GetDateTime(4)));
            }
        }
        catch { /* graceful empty bucket */ }
        return rows;
    }

    private static async Task<IReadOnlyList<CohortEngagementTierDto>> GetEngagementTierAsync(
        DbConnection conn, AdminScope scope, CancellationToken ct)
    {
        // Tiers come from mis.wvfd_weekly.engagement_tier (already in
        // the materialized projection used elsewhere in the codebase).
        // Always emit all 4 tiers (A/B/C/D) zero-filled.
        var counts = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["A"] = 0, ["B"] = 0, ["C"] = 0, ["D"] = 0
        };
        try
        {
            var (join, where) = ScopeJoin(scope, "w.farm_id");
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                SELECT COALESCE(w.engagement_tier, 'D') AS tier, COUNT(*) AS n
                FROM mis.wvfd_weekly w
                {join}
                WHERE w.week_start = (SELECT MAX(week_start) FROM mis.wvfd_weekly)
                  {where}
                GROUP BY tier
                """;
            if (!scope.IsPlatformAdmin) AddParam(cmd, "@org", scope.OrganizationId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var t = r.GetString(0);
                if (counts.ContainsKey(t)) counts[t] = (int)r.GetInt64(1);
            }
        }
        catch { /* graceful */ }

        return new[] { "A", "B", "C", "D" }
            .Select(t => new CohortEngagementTierDto(t, counts[t]))
            .ToList();
    }

    private static async Task<IReadOnlyList<CohortPillarHeatmapDto>> GetPillarHeatmapAsync(
        DbConnection conn, AdminScope scope, CancellationToken ct)
    {
        // Pillar weights for "failing" threshold (50% of weight per ADR).
        var pillars = new (string Name, string Col, decimal HalfWeight)[]
        {
            ("triggerFit",       "pillar_trigger_fit",        5m),
            ("actionSimplicity", "pillar_action_simplicity", 10m),
            ("proof",            "pillar_proof",             12.5m),
            ("reward",           "pillar_reward",             5m),
            ("investment",       "pillar_investment",         5m),
            ("repeat",           "pillar_repeat",            12.5m)
        };

        var rows = new List<CohortPillarHeatmapDto>(pillars.Length);
        var (join, where) = ScopeJoin(scope, "d.farm_id");
        foreach (var (name, col, halfW) in pillars)
        {
            try
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = $"""
                    SELECT
                        COALESCE(ROUND(AVG(d.{col})::numeric, 2), 0)              AS avg_score,
                        COUNT(*) FILTER (WHERE d.{col} < @half)                   AS failing
                    FROM mis.dwc_score_per_farm_week d
                    {join}
                    WHERE d.week_start = (SELECT MAX(week_start) FROM mis.dwc_score_per_farm_week)
                      {where}
                    """;
                AddParam(cmd, "@half", halfW);
                if (!scope.IsPlatformAdmin) AddParam(cmd, "@org", scope.OrganizationId);
                using var r = await cmd.ExecuteReaderAsync(ct);
                if (await r.ReadAsync(ct))
                {
                    rows.Add(new CohortPillarHeatmapDto(
                        Pillar: name,
                        AvgScore: r.IsDBNull(0) ? 0m : r.GetDecimal(0),
                        FailingFarmsCount: (int)r.GetInt64(1)));
                    continue;
                }
            }
            catch { /* fall through to zero row */ }
            rows.Add(new CohortPillarHeatmapDto(name, 0m, 0));
        }
        return rows;
    }

    private static async Task<IReadOnlyList<CohortWeeklyTrendDto>> GetWeeklyTrendAsync(
        DbConnection conn, AdminScope scope, CancellationToken ct)
    {
        var rows = new List<CohortWeeklyTrendDto>(8);
        try
        {
            var (join, where) = ScopeJoin(scope, "d.farm_id");
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                SELECT
                    d.week_start,
                    ROUND(AVG(d.score)::numeric, 2) AS avg_score,
                    COUNT(DISTINCT d.farm_id)       AS farm_count
                FROM mis.dwc_score_per_farm_week d
                {join}
                WHERE d.week_start >= CURRENT_DATE - INTERVAL '8 weeks'
                  {where}
                GROUP BY d.week_start
                ORDER BY d.week_start ASC
                """;
            if (!scope.IsPlatformAdmin) AddParam(cmd, "@org", scope.OrganizationId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                rows.Add(new CohortWeeklyTrendDto(
                    WeekStart: DateOnly.FromDateTime(r.GetDateTime(0)),
                    AvgScore: r.GetDecimal(1),
                    FarmCount: (int)r.GetInt64(2)));
            }
        }
        catch { /* graceful empty trend */ }
        return rows;
    }

    private static async Task<IReadOnlyList<CohortFarmerSufferingDto>> GetSufferingTop10Async(
        DbConnection conn, AdminScope scope, CancellationToken ct)
    {
        // Reuses the existing mis.farmer_suffering_watchlist matview
        // (same source AdminMisRepository.GetSufferingAsync uses).
        var rows = new List<CohortFarmerSufferingDto>(10);
        try
        {
            var (join, where) = ScopeJoin(scope, "s.farm_id");
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                SELECT
                    s.farm_id,
                    COALESCE(f.name, s.farm_id::text) AS farmer_name,
                    s.error_count,
                    s.last_error_at
                FROM mis.farmer_suffering_watchlist s
                {join}
                LEFT JOIN ssf.farms f ON f."Id" = s.farm_id
                WHERE 1=1
                  {where}
                ORDER BY s.error_count DESC
                LIMIT 10
                """;
            if (!scope.IsPlatformAdmin) AddParam(cmd, "@org", scope.OrganizationId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                rows.Add(new CohortFarmerSufferingDto(
                    FarmId: r.GetGuid(0),
                    FarmerName: r.GetString(1),
                    ErrorCount7d: r.GetInt32(2),
                    LastErrorAt: r.GetDateTime(3)));
            }
        }
        catch { /* graceful empty */ }
        return rows;
    }

    private static void AddParam(System.Data.IDbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
