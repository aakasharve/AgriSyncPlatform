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
    /// The original body added 14 matviews including
    /// <c>feature_retention_lift</c>, <c>new_farm_day_snapshot</c>,
    /// a redefined <c>silent_churn_watchlist</c>,
    /// <c>zero_engagement_farms</c>, <c>activity_heatmap</c>,
    /// <c>cohort_quality_score</c>, and the eight R1–R8 alert
    /// matviews. None had a production reader. The
    /// <c>silent_churn_watchlist</c> + <c>zero_engagement_farms</c>
    /// joined <c>accounts.subscriptions.farm_id</c> which has never
    /// existed. The R-alerts depended on Phase 4 base matviews that
    /// also failed to apply, so this migration could not run on a
    /// fresh DB even before its own column-drift bugs surfaced.
    /// </para>
    ///
    /// <para>
    /// Per the 2026-05-01 D3.B scope correction (signed off by Akash),
    /// the dropped matviews are tracked under
    /// <c>T-IGH-03-MIS-MATVIEW-REDESIGN</c> for reintroduction once a
    /// proper subscription→farm cross-aggregate model is designed.
    /// <c>AnalyticsRewrite</c> rebuilds only the production-read
    /// surface (R9 + R10 alerts; <c>farmer_suffering_watchlist</c>;
    /// <c>wvfd_weekly</c>; etc.).
    /// </para>
    /// </remarks>
    public partial class Phase7_BehavioralAnalytics : Migration
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
