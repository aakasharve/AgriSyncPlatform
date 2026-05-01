using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <inheritdoc />
    /// <remarks>
    /// **NO-OP since 2026-05-01** — superseded by
    /// <c>20260502000000_AnalyticsRewrite</c> per Sub-plan 03 Task 9.
    ///
    /// <para>
    /// The original body added five ops-observability matviews:
    /// <c>api_health_24h</c>, <c>farmer_suffering_watchlist</c>,
    /// <c>voice_pipeline_health</c>, <c>alert_r9_api_error_spike</c>,
    /// <c>alert_r10_voice_degraded</c>. The five matviews referenced
    /// <c>analytics.events</c> only, with correct column names — they
    /// were the only legacy migration in the chain that could
    /// theoretically apply on a fresh DB. However they depended on the
    /// <c>mis</c> schema being created by Phase 4 (which couldn't
    /// apply), so the chain still broke before reaching this
    /// migration on a clean Postgres.
    /// </para>
    ///
    /// <para>
    /// Per the 2026-05-01 D3.B scope correction:
    /// <list type="bullet">
    /// <item><c>farmer_suffering_watchlist</c>,
    /// <c>alert_r9_api_error_spike</c>, <c>alert_r10_voice_degraded</c>
    /// are recreated in <c>AnalyticsRewrite</c> (production code reads
    /// them).</item>
    /// <item><c>api_health_24h</c> + <c>voice_pipeline_health</c> are
    /// dropped (no in-process reader; legacy comments mentioned
    /// "Metabase Card 13/14" but no in-repo consumer exists).
    /// Tracked under <c>T-IGH-03-MIS-MATVIEW-REDESIGN</c> if needed
    /// later.</item>
    /// </list>
    /// </para>
    /// </remarks>
    public partial class Phase_OpsObservability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // INTENTIONALLY EMPTY — see class remarks. Superseded by
            // 20260502000000_AnalyticsRewrite.
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // INTENTIONALLY EMPTY — see class remarks.
        }
    }
}
