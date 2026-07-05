using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFarmOperationsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "farm_operations",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    operation_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    operation_date = table.Column<DateOnly>(type: "date", nullable: false),
                    source_daily_log_id = table.Column<Guid>(type: "uuid", nullable: true),
                    derived_event_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    is_current_version = table.Column<bool>(type: "boolean", nullable: false),
                    superseded_by_operation_id = table.Column<Guid>(type: "uuid", nullable: true),
                    district_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    dialect_region = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    model_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    prompt_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    prompt_content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    app_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    extractor_code_sha = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_operations", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_farm_operations_current_key",
                schema: "ssf",
                table: "farm_operations",
                columns: new[] { "farm_id", "derived_event_key" },
                unique: true,
                filter: "is_current_version");

            migrationBuilder.CreateIndex(
                name: "ix_farm_operations_farm_id",
                schema: "ssf",
                table: "farm_operations",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_farm_operations_source_daily_log_id",
                schema: "ssf",
                table: "farm_operations",
                column: "source_daily_log_id");

            // ── RLS (ADR 0023 §2 — DIRECT farm_id, NULLIF-hardened from day one) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.farm_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_farm_operations ON ssf.farm_operations;
CREATE POLICY p_tenant_farm_operations ON ssf.farm_operations
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DROP POLICY IF EXISTS p_user_select_farm_operations ON ssf.farm_operations;
CREATE POLICY p_user_select_farm_operations ON ssf.farm_operations
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = farm_operations.farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status NOT IN (5, 6)
        )
      )
  ));
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_farm_operations ON ssf.farm_operations;
DROP POLICY IF EXISTS p_tenant_farm_operations ON ssf.farm_operations;
");

            migrationBuilder.DropTable(
                name: "farm_operations",
                schema: "ssf");
        }
    }
}
