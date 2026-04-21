using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddComplianceSignalsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "compliance_signals",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: true),
                    rule_code = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    severity = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    suggested_action = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    title_en = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    title_mr = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    description_en = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    description_mr = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    payload_json = table.Column<string>(type: "jsonb", nullable: false),
                    first_seen_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_seen_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    acknowledged_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    acknowledged_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    resolved_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    resolved_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    resolution_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_compliance_signals", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_compliance_signals_farm_id",
                schema: "ssf",
                table: "compliance_signals",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_compliance_signals_last_seen_at_utc",
                schema: "ssf",
                table: "compliance_signals",
                column: "last_seen_at_utc");

            migrationBuilder.CreateIndex(
                name: "ix_compliance_signals_open_unique",
                schema: "ssf",
                table: "compliance_signals",
                columns: new[] { "farm_id", "plot_id", "rule_code", "crop_cycle_id" },
                unique: true,
                filter: "resolved_at_utc IS NULL AND acknowledged_at_utc IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "compliance_signals",
                schema: "ssf");
        }
    }
}
