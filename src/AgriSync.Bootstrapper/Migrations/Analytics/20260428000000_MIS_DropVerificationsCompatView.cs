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
    /// The original body was the second patch attempt: it dropped
    /// the matviews that joined the prod-only <c>ssf.verifications</c>
    /// compat view, rebuilt them against
    /// <c>ssf.verification_events</c> directly, then dropped the
    /// compat view itself. Closer to correct than
    /// <c>MIS_MatViewHealthFix</c>, but still left
    /// <c>silent_churn_watchlist</c> joining
    /// <c>accounts.subscriptions.farm_id</c> (which doesn't exist),
    /// so the new <c>silent_churn_watchlist</c> still couldn't be
    /// created on a fresh DB. Required <c>mis</c> schema +
    /// <c>mis_reader</c> role (created by Phase 4) — which couldn't
    /// itself apply.
    /// </para>
    ///
    /// <para>
    /// The 2026-05-01 verifier round settled on a single canonical
    /// rebuild (<c>AnalyticsRewrite</c>) instead of layered patches.
    /// <c>AnalyticsRewrite</c>'s STEP 2 explicitly drops the
    /// <c>ssf.verifications</c> compat view (idempotent) and STEP 1
    /// re-asserts the <c>mis</c> schema + role bootstrap.
    /// </para>
    /// </remarks>
    public partial class MIS_DropVerificationsCompatView : Migration
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
            // INTENTIONALLY EMPTY — see class remarks. The original
            // body's Down() also threw (forward-only); the no-op
            // preserves the forward-only intent without the throw,
            // because rolling back to "before this migration ran"
            // is now an empty operation.
        }
    }
}
