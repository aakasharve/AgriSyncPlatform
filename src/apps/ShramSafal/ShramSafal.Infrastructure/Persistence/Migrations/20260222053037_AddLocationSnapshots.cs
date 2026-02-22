using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLocationSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "location_provider",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

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
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "location_provider",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "attachments",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    linked_entity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    linked_entity_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    uploaded_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    original_file_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    mime_type = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    storage_path = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    finalized_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attachments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ocr_results",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    attachment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    raw_text = table.Column<string>(type: "text", nullable: false),
                    extracted_fields_json = table.Column<string>(type: "text", nullable: false),
                    overall_confidence = table.Column<decimal>(type: "numeric(6,4)", precision: 6, scale: 4, nullable: false),
                    model_used = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    latency_ms = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ocr_results", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_attachments_farm_id",
                schema: "ssf",
                table: "attachments",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "IX_attachments_linked_entity_id_linked_entity_type",
                schema: "ssf",
                table: "attachments",
                columns: new[] { "linked_entity_id", "linked_entity_type" });

            migrationBuilder.CreateIndex(
                name: "IX_attachments_uploaded_by_user_id",
                schema: "ssf",
                table: "attachments",
                column: "uploaded_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_ocr_results_attachment_id",
                schema: "ssf",
                table: "ocr_results",
                column: "attachment_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "attachments",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "ocr_results",
                schema: "ssf");

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
        }
    }
}
