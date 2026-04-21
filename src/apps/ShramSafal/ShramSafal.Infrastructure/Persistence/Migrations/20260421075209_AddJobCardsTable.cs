using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddJobCardsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "job_card_id",
                schema: "ssf",
                table: "cost_entries",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "job_cards",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    assigned_worker_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    planned_date = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    started_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    completed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    linked_daily_log_id = table.Column<Guid>(type: "uuid", nullable: true),
                    payout_cost_entry_id = table.Column<Guid>(type: "uuid", nullable: true),
                    cancellation_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    cancelled_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    line_items = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'[]'::jsonb")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_job_cards", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_job_cards_assigned_worker_user_id",
                schema: "ssf",
                table: "job_cards",
                column: "assigned_worker_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_job_cards_farm_id",
                schema: "ssf",
                table: "job_cards",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_job_cards_modified_at_utc",
                schema: "ssf",
                table: "job_cards",
                column: "modified_at_utc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "job_cards",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "job_card_id",
                schema: "ssf",
                table: "cost_entries");
        }
    }
}
