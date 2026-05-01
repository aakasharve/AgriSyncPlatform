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
    /// The original body was the first attempted patch on top of
    /// Phase 4 / Phase 7. It rebuilt <c>wvfd_weekly</c>,
    /// <c>engagement_tier</c>, <c>silent_churn_watchlist</c>,
    /// <c>cohort_quality_score</c>, <c>alert_r2_wau_vs_wvfd</c>, and
    /// added <c>schedule_compliance_weekly</c> +
    /// <c>alert_r5_compliance_plateau</c>. It still
    /// <c>JOIN</c>'d on <c>ssf.verifications</c> (a manual prod compat
    /// view that was dropped by <c>MIS_DropVerificationsCompatView</c>),
    /// so it could not apply on a fresh DB. Original plan called this
    /// "the patch that fixed three root-cause bugs", but the fix
    /// itself was incomplete because the underlying schema was
    /// already wrong about <c>ssf.verifications</c> existing.
    /// </para>
    ///
    /// <para>
    /// The 2026-05-01 verifier round (D1.B / D2.A / D3.B scope
    /// correction) settled on a single canonical rebuild
    /// (<c>AnalyticsRewrite</c>) instead of layered patches.
    /// </para>
    /// </remarks>
    public partial class MIS_MatViewHealthFix : Migration
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
