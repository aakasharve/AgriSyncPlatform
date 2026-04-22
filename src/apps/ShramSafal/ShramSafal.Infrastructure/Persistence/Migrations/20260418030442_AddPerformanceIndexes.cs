using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Idempotent drop — this index was present in some older dev DBs from
            // manual state but never created by a prior migration, so fresh DBs
            // bootstrapped from zero would fail on a plain DropIndex. Raw SQL with
            // IF EXISTS works uniformly.
            migrationBuilder.Sql(
                "DROP INDEX IF EXISTS ssf.\"IX_cost_entries_entry_date_farm_id\";");

            migrationBuilder.CreateIndex(
                name: "IX_daily_logs_crop_cycle_id",
                schema: "ssf",
                table: "daily_logs",
                column: "crop_cycle_id");

            migrationBuilder.CreateIndex(
                name: "IX_daily_logs_farm_id",
                schema: "ssf",
                table: "daily_logs",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "IX_daily_logs_farm_id_log_date",
                schema: "ssf",
                table: "daily_logs",
                columns: new[] { "farm_id", "log_date" });

            migrationBuilder.CreateIndex(
                name: "IX_daily_logs_operator_user_id",
                schema: "ssf",
                table: "daily_logs",
                column: "operator_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_cost_entries_created_by_user_id",
                schema: "ssf",
                table: "cost_entries",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_cost_entries_crop_cycle_id",
                schema: "ssf",
                table: "cost_entries",
                column: "crop_cycle_id");

            migrationBuilder.CreateIndex(
                name: "IX_cost_entries_farm_id",
                schema: "ssf",
                table: "cost_entries",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "IX_cost_entries_farm_id_entry_date",
                schema: "ssf",
                table: "cost_entries",
                columns: new[] { "farm_id", "entry_date" });

            migrationBuilder.CreateIndex(
                name: "IX_cost_entries_plot_id",
                schema: "ssf",
                table: "cost_entries",
                column: "plot_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_daily_logs_crop_cycle_id",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropIndex(
                name: "IX_daily_logs_farm_id",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropIndex(
                name: "IX_daily_logs_farm_id_log_date",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropIndex(
                name: "IX_daily_logs_operator_user_id",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropIndex(
                name: "IX_cost_entries_created_by_user_id",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropIndex(
                name: "IX_cost_entries_crop_cycle_id",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropIndex(
                name: "IX_cost_entries_farm_id",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropIndex(
                name: "IX_cost_entries_farm_id_entry_date",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropIndex(
                name: "IX_cost_entries_plot_id",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.CreateIndex(
                name: "IX_cost_entries_entry_date_farm_id",
                schema: "ssf",
                table: "cost_entries",
                columns: new[] { "entry_date", "farm_id" });
        }
    }
}
