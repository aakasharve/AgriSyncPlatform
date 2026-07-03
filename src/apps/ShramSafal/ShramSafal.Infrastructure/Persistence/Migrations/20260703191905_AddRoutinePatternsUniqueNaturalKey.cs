using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// ai-intelligence-plan-2026-06-25 — add a UNIQUE natural-key constraint
    /// on <c>ssf.routine_patterns (farm_id, plot_id, operation_type)</c>.
    /// </summary>
    /// <remarks>
    /// <c>UpsertRoutineAsync</c> (LedgerDerivationService) treats
    /// <c>(farm_id, plot_id, operation_type)</c> as the natural key, but the
    /// table previously indexed only <c>farm_id</c>, so two concurrent
    /// first-confirms of the same routine could insert duplicate rows.
    /// <c>plot_id</c> is nullable and Postgres treats NULLs as DISTINCT in a
    /// plain unique index, so this uses <b>two partial unique indexes</b> —
    /// <c>ux_routine_patterns_farm_plot_op</c> WHERE <c>plot_id IS NOT NULL</c>
    /// and <c>ux_routine_patterns_farm_op_no_plot</c> WHERE
    /// <c>plot_id IS NULL</c> — matching the repository's
    /// <c>p.PlotId == plotId</c> (→ IS NULL) match semantics. Additive: the
    /// table is empty on a fresh prod deploy, so there is no dup-collision risk
    /// on apply. Down() drops both indexes.
    /// </remarks>
    public partial class AddRoutinePatternsUniqueNaturalKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ux_routine_patterns_farm_op_no_plot",
                schema: "ssf",
                table: "routine_patterns",
                columns: new[] { "farm_id", "operation_type" },
                unique: true,
                filter: "plot_id IS NULL");

            migrationBuilder.CreateIndex(
                name: "ux_routine_patterns_farm_plot_op",
                schema: "ssf",
                table: "routine_patterns",
                columns: new[] { "farm_id", "plot_id", "operation_type" },
                unique: true,
                filter: "plot_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ux_routine_patterns_farm_op_no_plot",
                schema: "ssf",
                table: "routine_patterns");

            migrationBuilder.DropIndex(
                name: "ux_routine_patterns_farm_plot_op",
                schema: "ssf",
                table: "routine_patterns");
        }
    }
}
