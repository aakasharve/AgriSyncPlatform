using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <inheritdoc />
    public partial class Phase_OpsObservability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- ==============================================================
-- Ops Observability Phase 2 — live engineering health views
-- Source: analytics.events (api.error, api.slow, client.error,
--         ai.invocation).  All three error types are written by
-- Phase 1 (RequestObservabilityMiddleware + /telemetry/client-error).
-- Before Phase 1 is deployed these views return empty result sets
-- (no error rows in the table yet) — graceful degradation by design.
-- ==============================================================

-- mis.api_health_24h
-- Top failing/slow endpoints in the last 24 hours.
-- Used by: Metabase Card 13, AdminOpsRepository
CREATE MATERIALIZED VIEW mis.api_health_24h AS
SELECT
    COALESCE(props->>'endpoint', 'unknown')           AS endpoint,
    COUNT(*)                                           AS error_count,
    ROUND(AVG((props->>'latencyMs')::numeric))         AS avg_latency_ms,
    MAX((props->>'latencyMs')::numeric)                AS max_latency_ms,
    COUNT(DISTINCT farm_id)                            AS farms_affected
FROM analytics.events
WHERE event_type IN ('api.error', 'api.slow', 'client.error')
  AND occurred_at_utc >= NOW() - INTERVAL '24 hours'
GROUP BY props->>'endpoint'
ORDER BY error_count DESC;

CREATE UNIQUE INDEX ux_mis_api_health_endpoint ON mis.api_health_24h (endpoint);

-- mis.farmer_suffering_watchlist
-- Farms that hit 3+ errors in the last 7 days — call them before they complain.
-- Used by: Metabase Card 14, AdminOpsRepository
CREATE MATERIALIZED VIEW mis.farmer_suffering_watchlist AS
SELECT
    farm_id,
    COUNT(*)                                                          AS error_count,
    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%sync%')         AS sync_errors,
    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%log%')          AS log_errors,
    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%voice%'
                       OR (event_type = 'ai.invocation'
                           AND props->>'outcome' = 'failure'))        AS voice_errors,
    COUNT(*) FILTER (WHERE event_type = 'client.error')              AS client_errors,
    MAX(occurred_at_utc)                                             AS last_error_at
FROM analytics.events
WHERE event_type IN ('api.error', 'client.error')
  AND occurred_at_utc >= NOW() - INTERVAL '7 days'
  AND farm_id IS NOT NULL
GROUP BY farm_id
HAVING COUNT(*) >= 3
ORDER BY error_count DESC;

CREATE UNIQUE INDEX ux_mis_farmer_suffering ON mis.farmer_suffering_watchlist (farm_id);

-- mis.voice_pipeline_health
-- Daily Sarvam/Gemini AI invocation health — failure rate and latency.
-- Used by: AdminOpsRepository (live stats also computed in-query;
--          this view gives the 14-day trend for Metabase).
CREATE MATERIALIZED VIEW mis.voice_pipeline_health AS
SELECT
    DATE_TRUNC('day', occurred_at_utc)::date                         AS day,
    COUNT(*)                                                          AS total_invocations,
    COUNT(*) FILTER (WHERE props->>'outcome' = 'failure')            AS failures,
    ROUND(
        COUNT(*) FILTER (WHERE props->>'outcome' = 'failure') * 100.0
        / NULLIF(COUNT(*), 0), 1)                                    AS failure_rate_pct,
    ROUND(AVG((props->>'latencyMs')::numeric))                       AS avg_latency_ms,
    ROUND(
        PERCENTILE_CONT(0.95) WITHIN GROUP (
            ORDER BY (props->>'latencyMs')::numeric))                 AS p95_latency_ms
FROM analytics.events
WHERE event_type = 'ai.invocation'
  AND occurred_at_utc >= NOW() - INTERVAL '14 days'
GROUP BY DATE_TRUNC('day', occurred_at_utc)
ORDER BY day DESC;

CREATE UNIQUE INDEX ux_mis_voice_pipeline ON mis.voice_pipeline_health (day);

-- mis.alert_r9_api_error_spike
-- Breach = >30 api.error events in the last 1 hour.
-- AlertDispatcherJob scans this daily at 03:30 UTC.
CREATE MATERIALIZED VIEW mis.alert_r9_api_error_spike AS
SELECT
    1                                                                  AS id,
    'R9_api_error_spike'                                               AS detector,
    'More than 30 API errors in 1 hour — farmers are hitting a server bug' AS description,
    (COUNT(*) > 30)                                                    AS breached
FROM analytics.events
WHERE event_type = 'api.error'
  AND occurred_at_utc >= NOW() - INTERVAL '1 hour';

CREATE UNIQUE INDEX ux_mis_alert_r9 ON mis.alert_r9_api_error_spike (id);

-- mis.alert_r10_voice_degraded
-- Breach = voice pipeline failure rate >20% in last 6 hours.
CREATE MATERIALIZED VIEW mis.alert_r10_voice_degraded AS
SELECT
    1                                                                  AS id,
    'R10_voice_degraded'                                               AS detector,
    'Voice parse failure rate >20% in 6h — farmers cannot use voice logging' AS description,
    (COUNT(*) FILTER (WHERE props->>'outcome' = 'failure') * 100.0
     / NULLIF(COUNT(*), 0) > 20)                                      AS breached
FROM analytics.events
WHERE event_type = 'ai.invocation'
  AND occurred_at_utc >= NOW() - INTERVAL '6 hours';

CREATE UNIQUE INDEX ux_mis_alert_r10 ON mis.alert_r10_voice_degraded (id);

GRANT SELECT ON ALL TABLES IN SCHEMA mis TO mis_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA mis GRANT SELECT ON TABLES TO mis_reader;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r10_voice_degraded;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r9_api_error_spike;
DROP MATERIALIZED VIEW IF EXISTS mis.voice_pipeline_health;
DROP MATERIALIZED VIEW IF EXISTS mis.farmer_suffering_watchlist;
DROP MATERIALIZED VIEW IF EXISTS mis.api_health_24h;
");
        }
    }
}
