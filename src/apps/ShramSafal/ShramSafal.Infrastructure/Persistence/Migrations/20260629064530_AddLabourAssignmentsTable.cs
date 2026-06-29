using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLabourAssignmentsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "labour_assignments",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    engagement_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    male_count = table.Column<int>(type: "integer", nullable: true),
                    female_count = table.Column<int>(type: "integer", nullable: true),
                    worker_count = table.Column<int>(type: "integer", nullable: true),
                    wage_per_person = table.Column<decimal>(type: "numeric", nullable: true),
                    contract_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    contract_quantity = table.Column<decimal>(type: "numeric", nullable: true),
                    total_cost = table.Column<decimal>(type: "numeric", nullable: true),
                    linked_activity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_labour_assignments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_labour_assignments_daily_log_id",
                schema: "ssf",
                table: "labour_assignments",
                column: "daily_log_id");

            // ── RLS (ADR 0023 §2 — EXISTS-join to daily_logs via daily_log_id, NULLIF) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.labour_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.labour_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_labour_assignments ON ssf.labour_assignments;
CREATE POLICY p_tenant_labour_assignments ON ssf.labour_assignments
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = labour_assignments.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (true);

DROP POLICY IF EXISTS p_user_select_labour_assignments ON ssf.labour_assignments;
CREATE POLICY p_user_select_labour_assignments ON ssf.labour_assignments
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    JOIN ssf.farms f ON f.""Id"" = d.farm_id
    WHERE d.""Id"" = labour_assignments.daily_log_id
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
DROP POLICY IF EXISTS p_user_select_labour_assignments ON ssf.labour_assignments;
DROP POLICY IF EXISTS p_tenant_labour_assignments ON ssf.labour_assignments;
");

            migrationBuilder.DropTable(
                name: "labour_assignments",
                schema: "ssf");
        }
    }
}
