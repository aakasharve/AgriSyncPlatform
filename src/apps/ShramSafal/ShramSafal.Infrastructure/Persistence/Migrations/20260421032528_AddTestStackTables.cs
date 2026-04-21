using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTestStackTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "test_protocols",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    crop_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    periodicity = table.Column<int>(type: "integer", nullable: false),
                    every_n_days = table.Column<int>(type: "integer", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    parameter_codes = table.Column<List<string>>(type: "text[]", nullable: false, defaultValueSql: "'{}'::text[]"),
                    stage_names = table.Column<List<string>>(type: "text[]", nullable: false, defaultValueSql: "'{}'::text[]")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_test_protocols", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "test_instances",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    test_protocol_id = table.Column<Guid>(type: "uuid", nullable: false),
                    protocol_kind = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    stage_name = table.Column<string>(type: "text", nullable: false),
                    planned_due_date = table.Column<DateOnly>(type: "date", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    collected_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    collected_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    reported_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reported_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    waived_reason = table.Column<string>(type: "text", nullable: true),
                    waived_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    waived_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    attachment_ids = table.Column<List<Guid>>(type: "uuid[]", nullable: false, defaultValueSql: "'{}'::uuid[]"),
                    results = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'[]'::jsonb")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_test_instances", x => x.id);
                    table.ForeignKey(
                        name: "FK_test_instances_test_protocols_test_protocol_id",
                        column: x => x.test_protocol_id,
                        principalSchema: "ssf",
                        principalTable: "test_protocols",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "test_recommendations",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    test_instance_id = table.Column<Guid>(type: "uuid", nullable: false),
                    rule_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    title_en = table.Column<string>(type: "text", nullable: false),
                    title_mr = table.Column<string>(type: "text", nullable: false),
                    suggested_activity_name = table.Column<string>(type: "text", nullable: false),
                    suggested_offset_days = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_test_recommendations", x => x.id);
                    table.ForeignKey(
                        name: "FK_test_recommendations_test_instances_test_instance_id",
                        column: x => x.test_instance_id,
                        principalSchema: "ssf",
                        principalTable: "test_instances",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_test_instances_crop_cycle_id",
                schema: "ssf",
                table: "test_instances",
                column: "crop_cycle_id");

            migrationBuilder.CreateIndex(
                name: "IX_test_instances_farm_id",
                schema: "ssf",
                table: "test_instances",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_test_instances_modified_at_utc",
                schema: "ssf",
                table: "test_instances",
                column: "modified_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_test_instances_test_protocol_id",
                schema: "ssf",
                table: "test_instances",
                column: "test_protocol_id");

            migrationBuilder.CreateIndex(
                name: "IX_test_protocols_crop_type",
                schema: "ssf",
                table: "test_protocols",
                column: "crop_type");

            migrationBuilder.CreateIndex(
                name: "IX_test_recommendations_test_instance_id",
                schema: "ssf",
                table: "test_recommendations",
                column: "test_instance_id");

            // Partial index for the farm overdue/due board — EF's fluent API
            // cannot express the WHERE clause, so the SQL is hand-written here.
            // Covers CEI §4.5 GetMissingTestsForFarm: status IN (Due=0, Overdue=3).
            migrationBuilder.Sql(
                "CREATE INDEX ix_test_instances_farm_due_status " +
                "ON ssf.test_instances (farm_id, planned_due_date) " +
                "WHERE status IN (0, 3);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ssf.ix_test_instances_farm_due_status;");

            migrationBuilder.DropTable(
                name: "test_recommendations",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "test_instances",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "test_protocols",
                schema: "ssf");
        }
    }
}
