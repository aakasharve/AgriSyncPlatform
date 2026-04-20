using AgriSync.BuildingBlocks.Analytics;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using System.Text.Json;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// Queries analytics.events directly for live operational health.
/// Uses raw SQL via AnalyticsDbContext connection — no SaveChanges ever.
///
/// Graceful degradation: if a view or column doesn't exist yet
/// (e.g. api.error events before Ops Phase 1 middleware is deployed),
/// the query returns empty collections rather than throwing.
/// </summary>
public sealed class AdminOpsRepository(AnalyticsDbContext analyticsContext) : IAdminOpsRepository
{
    public async Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);

        try
        {
            var voice = await GetVoiceHealthAsync(conn, ct);
            var errors = await GetRecentErrorsAsync(conn, ct);
            var suffering = await GetTopSufferingFarmsAsync(conn, ct);
            var (r9, r10) = await GetAlertBreachesAsync(conn, ct);

            return new AdminOpsHealthDto(
                VoiceInvocations24h: voice.total,
                VoiceFailures24h: voice.failures,
                VoiceFailureRatePct: voice.failureRate,
                VoiceAvgLatencyMs: voice.avgLatency,
                VoiceP95LatencyMs: voice.p95Latency,
                RecentErrors: errors,
                TopSufferingFarms: suffering,
                ApiErrorSpike: r9,
                VoiceDegraded: r10,
                ComputedAtUtc: DateTime.UtcNow);
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync();
        }
    }

    private static async Task<(int total, int failures, decimal failureRate, decimal avgLatency, decimal p95Latency)>
        GetVoiceHealthAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    COUNT(*)                                                          AS total,
                    COUNT(*) FILTER (WHERE props->>'outcome' = 'failure')            AS failures,
                    COALESCE(ROUND(
                        COUNT(*) FILTER (WHERE props->>'outcome' = 'failure') * 100.0
                        / NULLIF(COUNT(*), 0), 1), 0)                               AS failure_rate,
                    COALESCE(ROUND(AVG((props->>'latencyMs')::numeric)), 0)          AS avg_latency,
                    COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP
                        (ORDER BY (props->>'latencyMs')::numeric)), 0)              AS p95_latency
                FROM analytics.events
                WHERE event_type = 'ai.invocation'
                  AND occurred_at_utc >= NOW() - INTERVAL '24 hours'
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                return (
                    r.IsDBNull(0) ? 0 : (int)r.GetInt64(0),
                    r.IsDBNull(1) ? 0 : (int)r.GetInt64(1),
                    r.IsDBNull(2) ? 0m : r.GetDecimal(2),
                    r.IsDBNull(3) ? 0m : r.GetDecimal(3),
                    r.IsDBNull(4) ? 0m : r.GetDecimal(4));
            }
        }
        catch { /* table may not exist in test env */ }
        return (0, 0, 0m, 0m, 0m);
    }

    private static async Task<IReadOnlyList<OpsErrorEventDto>> GetRecentErrorsAsync(
        System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        var results = new List<OpsErrorEventDto>();
        try
        {
            using var cmd = conn.CreateCommand();
            // api.error events are populated after RequestObservabilityMiddleware ships (Ops Phase 1).
            // client.error events are populated after ClientErrorReporter ships (Ops Phase 3).
            // Query gracefully returns empty list until those phases are deployed.
            cmd.CommandText = """
                SELECT
                    event_type,
                    COALESCE(props->>'endpoint', 'unknown')  AS endpoint,
                    (props->>'statusCode')::int              AS status_code,
                    (props->>'latencyMs')::int               AS latency_ms,
                    farm_id,
                    occurred_at_utc
                FROM analytics.events
                WHERE event_type IN ('api.error', 'api.slow', 'client.error')
                  AND occurred_at_utc >= NOW() - INTERVAL '2 hours'
                ORDER BY occurred_at_utc DESC
                LIMIT 50
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                results.Add(new OpsErrorEventDto(
                    EventType: r.GetString(0),
                    Endpoint: r.GetString(1),
                    StatusCode: r.IsDBNull(2) ? null : r.GetInt32(2),
                    LatencyMs: r.IsDBNull(3) ? null : r.GetInt32(3),
                    FarmId: r.IsDBNull(4) ? null : r.GetGuid(4),
                    OccurredAtUtc: r.GetDateTime(5)));
            }
        }
        catch { /* graceful — returns empty */ }
        return results;
    }

    private static async Task<IReadOnlyList<OpsFarmErrorDto>> GetTopSufferingFarmsAsync(
        System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        var results = new List<OpsFarmErrorDto>();
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    farm_id,
                    COUNT(*)                                                           AS error_count,
                    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%sync%')          AS sync_errors,
                    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%log%')           AS log_errors,
                    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%voice%'
                                       OR event_type = 'ai.invocation'
                                       AND props->>'outcome' = 'failure')             AS voice_errors,
                    MAX(occurred_at_utc)                                              AS last_error_at
                FROM analytics.events
                WHERE event_type IN ('api.error', 'client.error')
                  AND occurred_at_utc >= NOW() - INTERVAL '24 hours'
                  AND farm_id IS NOT NULL
                GROUP BY farm_id
                HAVING COUNT(*) >= 2
                ORDER BY error_count DESC
                LIMIT 10
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                results.Add(new OpsFarmErrorDto(
                    FarmId: r.GetGuid(0),
                    ErrorCount: (int)r.GetInt64(1),
                    SyncErrors: (int)r.GetInt64(2),
                    LogErrors: (int)r.GetInt64(3),
                    VoiceErrors: (int)r.GetInt64(4),
                    LastErrorAt: r.GetDateTime(5)));
            }
        }
        catch { /* graceful — returns empty */ }
        return results;
    }

    private static async Task<(bool? r9, bool? r10)> GetAlertBreachesAsync(
        System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        // mis.alert_r9/r10 views only exist after Ops Phase 2 migration.
        // Returns null (unknown) until then — frontend shows "—" rather than false.
        bool? r9 = null, r10 = null;
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT breached FROM mis.alert_r9_api_error_spike LIMIT 1";
            var raw = await cmd.ExecuteScalarAsync(ct);
            if (raw is bool b9) r9 = b9;
        }
        catch { /* view not yet created */ }
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT breached FROM mis.alert_r10_voice_degraded LIMIT 1";
            var raw = await cmd.ExecuteScalarAsync(ct);
            if (raw is bool b10) r10 = b10;
        }
        catch { /* view not yet created */ }
        return (r9, r10);
    }
}
