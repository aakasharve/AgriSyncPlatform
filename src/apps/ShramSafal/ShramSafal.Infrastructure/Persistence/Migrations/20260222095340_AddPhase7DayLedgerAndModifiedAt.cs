using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPhase7DayLedgerAndModifiedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "modified_at_utc",
                schema: "ssf",
                table: "price_configs",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "modified_at_utc",
                schema: "ssf",
                table: "plots",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "modified_at_utc",
                schema: "ssf",
                table: "planned_activities",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "modified_at_utc",
                schema: "ssf",
                table: "finance_corrections",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "modified_at_utc",
                schema: "ssf",
                table: "farms",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<decimal>(
                name: "location_accuracy_meters",
                schema: "ssf",
                table: "daily_logs",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "location_altitude",
                schema: "ssf",
                table: "daily_logs",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "location_captured_at_utc",
                schema: "ssf",
                table: "daily_logs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "location_latitude",
                schema: "ssf",
                table: "daily_logs",
                type: "numeric(10,7)",
                precision: 10,
                scale: 7,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "location_longitude",
                schema: "ssf",
                table: "daily_logs",
                type: "numeric(10,7)",
                precision: 10,
                scale: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "location_permission_state",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "location_provider",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "modified_at_utc",
                schema: "ssf",
                table: "daily_logs",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "modified_at_utc",
                schema: "ssf",
                table: "crop_cycles",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<decimal>(
                name: "location_accuracy_meters",
                schema: "ssf",
                table: "cost_entries",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "location_altitude",
                schema: "ssf",
                table: "cost_entries",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "location_captured_at_utc",
                schema: "ssf",
                table: "cost_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "location_latitude",
                schema: "ssf",
                table: "cost_entries",
                type: "numeric(10,7)",
                precision: 10,
                scale: 7,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "location_longitude",
                schema: "ssf",
                table: "cost_entries",
                type: "numeric(10,7)",
                precision: 10,
                scale: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "location_permission_state",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "location_provider",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "modified_at_utc",
                schema: "ssf",
                table: "cost_entries",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.CreateTable(
                name: "day_ledgers",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_cost_entry_id = table.Column<Guid>(type: "uuid", nullable: false),
                    ledger_date = table.Column<DateOnly>(type: "date", nullable: false),
                    allocation_basis = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_day_ledgers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "day_ledger_allocations",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    allocated_amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    currency_code = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    allocated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    day_ledger_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_day_ledger_allocations", x => x.id);
                    table.ForeignKey(
                        name: "FK_day_ledger_allocations_day_ledgers_day_ledger_id",
                        column: x => x.day_ledger_id,
                        principalSchema: "ssf",
                        principalTable: "day_ledgers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_price_configs_modified_at_utc",
                schema: "ssf",
                table: "price_configs",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_plots_modified_at_utc",
                schema: "ssf",
                table: "plots",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_planned_activities_modified_at_utc",
                schema: "ssf",
                table: "planned_activities",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_finance_corrections_modified_at_utc",
                schema: "ssf",
                table: "finance_corrections",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_farms_modified_at_utc",
                schema: "ssf",
                table: "farms",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_daily_logs_modified_at_utc",
                schema: "ssf",
                table: "daily_logs",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_crop_cycles_modified_at_utc",
                schema: "ssf",
                table: "crop_cycles",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_cost_entries_modified_at_utc",
                schema: "ssf",
                table: "cost_entries",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_day_ledger_allocations_allocated_at_utc",
                schema: "ssf",
                table: "day_ledger_allocations",
                column: "allocated_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_day_ledger_allocations_day_ledger_id",
                schema: "ssf",
                table: "day_ledger_allocations",
                column: "day_ledger_id");

            migrationBuilder.CreateIndex(
                name: "IX_day_ledger_allocations_plot_id",
                schema: "ssf",
                table: "day_ledger_allocations",
                column: "plot_id");

            migrationBuilder.CreateIndex(
                name: "IX_day_ledgers_farm_id_ledger_date",
                schema: "ssf",
                table: "day_ledgers",
                columns: new[] { "farm_id", "ledger_date" });

            migrationBuilder.CreateIndex(
                name: "IX_day_ledgers_modified_at_utc",
                schema: "ssf",
                table: "day_ledgers",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_day_ledgers_source_cost_entry_id",
                schema: "ssf",
                table: "day_ledgers",
                column: "source_cost_entry_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "day_ledger_allocations",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "day_ledgers",
                schema: "ssf");

            migrationBuilder.DropIndex(
                name: "IX_price_configs_modified_at_utc",
                schema: "ssf",
                table: "price_configs");

            migrationBuilder.DropIndex(
                name: "IX_plots_modified_at_utc",
                schema: "ssf",
                table: "plots");

            migrationBuilder.DropIndex(
                name: "IX_planned_activities_modified_at_utc",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropIndex(
                name: "IX_finance_corrections_modified_at_utc",
                schema: "ssf",
                table: "finance_corrections");

            migrationBuilder.DropIndex(
                name: "IX_farms_modified_at_utc",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropIndex(
                name: "IX_daily_logs_modified_at_utc",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropIndex(
                name: "IX_crop_cycles_modified_at_utc",
                schema: "ssf",
                table: "crop_cycles");

            migrationBuilder.DropIndex(
                name: "IX_cost_entries_modified_at_utc",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "price_configs");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "plots");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "finance_corrections");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "location_accuracy_meters",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_altitude",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_captured_at_utc",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_latitude",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_longitude",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_permission_state",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_provider",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "crop_cycles");

            migrationBuilder.DropColumn(
                name: "location_accuracy_meters",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_altitude",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_captured_at_utc",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_latitude",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_longitude",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_permission_state",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_provider",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "cost_entries");
        }
    }
}
