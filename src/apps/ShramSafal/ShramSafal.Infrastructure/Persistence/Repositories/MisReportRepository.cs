using AgriSync.BuildingBlocks.Analytics;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// Phase 6 Owner MIS — reads mis.* materialized views via raw SQL through
/// AnalyticsDbContext's underlying connection. All queries are read-only
/// (no SaveChanges). If a view is empty for the farm (no data yet) the
/// method returns null — the handler produces a zero-state DTO.
/// </summary>
public sealed class MisReportRepository(AnalyticsDbContext analyticsContext) : IMisReportRepository
{
    public async Task<FarmWeekMisDto?> GetFarmWeekMisAsync(Guid farmId, CancellationToken ct = default)
    {
        var connection = analyticsContext.Database.GetDbConnection();
        var wasOpen = connection.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await connection.OpenAsync(ct);

        try
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = """
                SELECT
                    w.wvfd,
                    w.engagement_tier,
                    lag.median_hours_lag,
                    cr.correction_rate_pct,
                    vs.voice_share_pct,
                    sc.compliance_pct,
                    su.unscheduled_pct,
                    ai.cost_7d
                FROM (VALUES (@farmId::uuid)) AS f(fid)
                LEFT JOIN mis.wvfd_weekly          w   ON w.farm_id   = f.fid
                LEFT JOIN mis.log_verify_lag        lag ON lag.farm_id = f.fid
                LEFT JOIN mis.correction_rate       cr  ON cr.farm_id  = f.fid
                LEFT JOIN mis.voice_log_share       vs  ON vs.farm_id  = f.fid
                LEFT JOIN (
                    SELECT farm_id, AVG(compliance_pct) AS compliance_pct
                    FROM mis.schedule_compliance_weekly
                    WHERE week_start >= CURRENT_DATE - INTERVAL '7 days'
                    GROUP BY farm_id
                ) sc ON sc.farm_id = f.fid
                LEFT JOIN mis.schedule_unscheduled_ratio su ON su.farm_id = f.fid
                LEFT JOIN (
                    SELECT farm_id, SUM(total_cost_usd) AS cost_7d
                    FROM mis.gemini_cost_per_farm
                    WHERE day >= CURRENT_DATE - INTERVAL '7 days'
                    GROUP BY farm_id
                ) ai ON ai.farm_id = f.fid
                """;

            var p = cmd.CreateParameter();
            p.ParameterName = "@farmId";
            p.Value = farmId;
            cmd.Parameters.Add(p);

            using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return null;

            // If wvfd is null the farm doesn't appear in the view — no data yet.
            if (reader.IsDBNull(0)) return null;

            return new FarmWeekMisDto(
                FarmId: farmId,
                Wvfd: reader.GetDecimal(0),
                EngagementTier: reader.IsDBNull(1) ? "D" : reader.GetString(1),
                MedianVerifyLagHours: reader.IsDBNull(2) ? null : reader.GetDecimal(2),
                CorrectionRatePct: reader.IsDBNull(3) ? null : reader.GetDecimal(3),
                VoiceSharePct: reader.IsDBNull(4) ? null : reader.GetDecimal(4),
                ScheduleCompliancePct: reader.IsDBNull(5) ? null : reader.GetDecimal(5),
                UnscheduledLogPct: reader.IsDBNull(6) ? null : reader.GetDecimal(6),
                AiCostUsd7d: reader.IsDBNull(7) ? null : reader.GetDecimal(7));
        }
        finally
        {
            if (!wasOpen) await connection.CloseAsync();
        }
    }
}
