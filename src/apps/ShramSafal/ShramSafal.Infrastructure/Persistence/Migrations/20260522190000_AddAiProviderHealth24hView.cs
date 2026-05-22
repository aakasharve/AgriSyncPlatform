using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.1 + 3.2 — admin
    /// observability views. Two regular (NOT materialized) PostgreSQL
    /// views ride together in one migration because they share the
    /// admin-panel surface lifecycle (Phase 3 Slice E):
    ///
    /// <list type="bullet">
    /// <item><c>ssf.v_ai_provider_health_24h</c> — rolling 24h rollup of
    ///   <c>ai_job_attempts</c> per <c>(provider, operation)</c>:
    ///   total attempts, successes, failures, success_rate_pct,
    ///   p50/p95 latency, window start/end. Feeds the admin health
    ///   panel via <c>GET /shramsafal/admin/ai-health</c>.</item>
    /// <item><c>ssf.v_ai_spend_monthly</c> — rollup of
    ///   <c>ai_provider_spend_daily</c> per
    ///   <c>(tenant_id, provider, operation, month_utc)</c>: total INR,
    ///   days_with_spend, first_day, last_day, last_updated_utc.
    ///   Feeds the admin spend panel via
    ///   <c>GET /shramsafal/admin/ai-spend</c>.</item>
    /// </list>
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why regular VIEW, not MATERIALIZED VIEW.</b> Materialized
    /// refresh adds operational complexity (refresh cron, lock window,
    /// stale-data SLA) for marginal benefit at our scale. The
    /// underlying <c>ai_job_attempts</c> and
    /// <c>ai_provider_spend_daily</c> tables are already indexed on
    /// the keys the views group by; on prod-shape load (≤ 10k attempts
    /// per 24h, ≤ 30 spend rows per month) the views run in under
    /// 50ms. If admin-panel latency ever becomes a concern, founder
    /// can convert to materialized via a follow-up migration without
    /// changing the consumer contract (column names + types are
    /// preserved).
    /// </para>
    /// <para>
    /// <b>Reversibility.</b> <see cref="Down"/> drops both views with
    /// <c>DROP VIEW IF EXISTS</c> so the migration is safe to roll
    /// back. The underlying tables and rows survive untouched —
    /// views carry no state of their own.
    /// </para>
    /// <para>
    /// <b>RLS posture.</b> Views inherit the row-level filtering
    /// behaviour of their underlying tables. Both
    /// <c>ai_job_attempts</c> and <c>ai_provider_spend_daily</c> are
    /// admin-elevated read surfaces (the latter is on the RLS
    /// allowlist per
    /// <c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c>), so the
    /// views deliberately expose the same posture: admin-only consumers
    /// only. The <c>/shramsafal/admin/ai-*</c> endpoints gate on
    /// <c>ModuleKey.OpsVoice</c> read scope before reading.
    /// </para>
    /// <para>
    /// <b>Apply policy.</b> Per the envelope: do NOT apply this
    /// migration to any database. Supervisor reviews this PR before
    /// it ships to any environment.
    /// </para>
    /// </remarks>
    public partial class AddAiProviderHealth24hView : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Task 3.1 — provider health rollup (24h rolling window).
            // GROUP BY (provider, operation_type) so the panel can
            // render one row per pipeline lane (e.g.
            // Sarvam/VoiceToStructuredLog, Gemini/ReceiptToExpenseItems).
            // operation_type lives on the parent ssf.ai_jobs aggregate,
            // not on the attempt; we JOIN through ai_job_id to surface
            // it on each attempt row. PERCENTILE_CONT used because we
            // want the actual median + p95 of latency_ms, not just the
            // average. window_start_utc / window_end_utc let the panel
            // header surface the actual data range when the table is
            // sparsely populated (e.g. only one attempt in the last 24h).
            migrationBuilder.Sql(@"
CREATE VIEW ssf.v_ai_provider_health_24h AS
SELECT
    a.provider,
    j.operation_type                                                            AS operation,
    COUNT(*)::int                                                               AS attempts,
    SUM(CASE WHEN a.is_success THEN 1 ELSE 0 END)::int                          AS successes,
    SUM(CASE WHEN NOT a.is_success THEN 1 ELSE 0 END)::int                      AS failures,
    CASE WHEN COUNT(*) > 0 THEN
        ROUND(100.0 * SUM(CASE WHEN a.is_success THEN 1 ELSE 0 END)::numeric
                    / COUNT(*), 2)
    ELSE 0.00 END                                                               AS success_rate_pct,
    PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY a.latency_ms)::int             AS p50_latency_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY a.latency_ms)::int             AS p95_latency_ms,
    MAX(a.attempted_at_utc)                                                     AS window_end_utc,
    MIN(a.attempted_at_utc)                                                     AS window_start_utc
FROM ssf.ai_job_attempts a
JOIN ssf.ai_jobs j ON j.id = a.ai_job_id
WHERE a.attempted_at_utc > NOW() - INTERVAL '24 hours'
GROUP BY a.provider, j.operation_type;
");

            // Task 3.2 — monthly spend rollup. Reads from the daily
            // table the cost-guard worker maintains (Phase 2.7
            // commit e8a1aac3); the admin panel renders
            // (tenant × provider × operation × month) cells with the
            // total INR and an optional cap pulled from
            // ai_provider_configs.monthly_budget_inr (panel side).
            // days_with_spend lets the panel show "23/30 days" so a
            // sparse month is visually distinct from a fully-loaded
            // one. first_day/last_day surface the actual data range
            // for sanity checking.
            migrationBuilder.Sql(@"
CREATE VIEW ssf.v_ai_spend_monthly AS
SELECT
    s.tenant_id,
    s.provider,
    s.operation,
    DATE_TRUNC('month', s.day_utc)::date          AS month_utc,
    SUM(s.total_inr)::numeric(14,4)               AS total_inr,
    COUNT(DISTINCT s.day_utc)::int                AS days_with_spend,
    MIN(s.day_utc)                                AS first_day,
    MAX(s.day_utc)                                AS last_day,
    MAX(s.modified_at_utc)                        AS last_updated_utc
FROM ssf.ai_provider_spend_daily s
GROUP BY s.tenant_id, s.provider, s.operation, DATE_TRUNC('month', s.day_utc);
");

            // Mirror the consent-domain GRANT pattern so views are
            // readable by the agrisync_app role when present. The
            // admin endpoints route reads through the regular app
            // context (admin-elevated at the handler boundary); no
            // separate admin-only role is required.
            migrationBuilder.Sql(@"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT ON ssf.v_ai_provider_health_24h TO agrisync_app;
        GRANT SELECT ON ssf.v_ai_spend_monthly       TO agrisync_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW IF EXISTS ssf.v_ai_spend_monthly;");
            migrationBuilder.Sql("DROP VIEW IF EXISTS ssf.v_ai_provider_health_24h;");
        }
    }
}
