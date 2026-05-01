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
    /// The original body created the <c>mis</c> schema, the
    /// <c>mis_reader</c> role, and 13 materialized views. The 13 matview
    /// definitions referenced columns that never matched the live
    /// schema:
    /// <list type="bullet">
    /// <item><c>ssf.verifications.log_id</c> /
    /// <c>ssf.verifications.verified_at_utc</c> — that table never
    /// existed; it was a manual prod compat view dropped on
    /// 2026-04-23.</item>
    /// <item><c>accounts.subscriptions.farm_id</c> /
    /// <c>.state</c> / <c>.current_period_end_utc</c> — none of these
    /// columns exist (subscriptions are per-OwnerAccount; the column
    /// is <c>status</c> as int; the period column is
    /// <c>valid_until_utc</c>).</item>
    /// <item><c>public.users.registered_at_utc</c> — column is
    /// <c>created_at_utc</c>.</item>
    /// <item><c>ssf.daily_logs.is_corrected</c> /
    /// <c>.verification_status</c> — neither exists; both are
    /// computed properties that EF marks as
    /// <c>Ignore</c>'d.</item>
    /// </list>
    /// On a fresh DB this migration always failed at the first
    /// <c>JOIN ssf.verifications</c>. The <c>mis</c> schema +
    /// <c>mis_reader</c> role bootstraps it once provided are
    /// re-asserted by <c>AnalyticsRewrite</c>'s <c>CREATE SCHEMA IF NOT
    /// EXISTS</c> + <c>DO $$ … CREATE ROLE … $$</c> idempotent guards.
    /// </para>
    ///
    /// <para>
    /// <b>Why no-op (not delete):</b> EF's <c>__EFMigrationsHistory</c>
    /// table on existing prod / staging DBs records this migration as
    /// applied. Deleting the file would either rewind history (bad)
    /// or require a manual cleanup script. Empty-body no-op keeps the
    /// chain replayable on both fresh and existing DBs.
    /// </para>
    /// </remarks>
    public partial class Phase4_MisSchemaRollups : Migration
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
            // INTENTIONALLY EMPTY — see class remarks. Forward-only;
            // rollback is via DB snapshot per RDS_PROVISIONING.md.
        }
    }
}
