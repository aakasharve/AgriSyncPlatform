using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.7 (Safeguard S9) —
    /// cost budget guardrail schema. Two additive changes bundled in
    /// one migration:
    ///
    /// <list type="bullet">
    /// <item><c>ssf.ai_provider_configs</c> gains
    ///   <c>monthly_budget_inr numeric(12,2) NULL</c> — admin-managed
    ///   monthly INR cap that the cost guardrail worker enforces.
    ///   Nullable so existing rows default to "unconstrained"; the
    ///   guardrail no-ops on NULL.</item>
    /// <item>A new <c>ssf.ai_provider_spend_daily</c> table is created
    ///   to hold the daily spend rollup the guardrail reads on every
    ///   tick. Composite index <c>(tenant_id, day_utc)</c> for the
    ///   month-to-date probe; unique index
    ///   <c>(tenant_id, provider, operation, day_utc)</c> backs the
    ///   idempotent upsert performed by the aggregator.</item>
    /// </list>
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>RLS posture.</b> <c>ai_provider_spend_daily</c> is added to
    /// the <c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c> set
    /// in the same envelope. Rationale: no farm dimension — admin
    /// managed. <c>tenant_id</c> is recorded for a future per-tenant
    /// budget but the rollup itself is read only by the admin-elevated
    /// guardrail worker.
    /// </para>
    /// <para>
    /// <b>Reversibility.</b> <c>Down()</c> drops the new table and
    /// then the new column. No data preservation — the rollup is
    /// recomputable from <c>ssf.ai_job_attempts.estimated_cost_units</c>.
    /// </para>
    /// <para>
    /// <b>Apply policy.</b> Per the envelope: do NOT apply this
    /// migration to any database. Supervisor reviews this PR before
    /// it ships to any environment.
    /// </para>
    /// </remarks>
    public partial class AddMonthlyBudgetInrToProviderConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "monthly_budget_inr",
                schema: "ssf",
                table: "ai_provider_configs",
                type: "numeric(12,2)",
                precision: 12,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ai_provider_spend_daily",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    operation = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    day_utc = table.Column<DateOnly>(type: "date", nullable: false),
                    total_inr = table.Column<decimal>(type: "numeric(14,4)", precision: 14, scale: 4, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_provider_spend_daily", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ai_provider_spend_daily_tenant_day",
                schema: "ssf",
                table: "ai_provider_spend_daily",
                columns: new[] { "tenant_id", "day_utc" });

            migrationBuilder.CreateIndex(
                name: "ux_ai_provider_spend_daily_tenant_provider_operation_day",
                schema: "ssf",
                table: "ai_provider_spend_daily",
                columns: new[] { "tenant_id", "provider", "operation", "day_utc" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_provider_spend_daily",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "monthly_budget_inr",
                schema: "ssf",
                table: "ai_provider_configs");
        }
    }
}
