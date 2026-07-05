using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMachineryUsagesTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "machinery_usages",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    machine_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ownership = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    hours_used = table.Column<decimal>(type: "numeric", nullable: true),
                    rental_cost = table.Column<decimal>(type: "numeric", nullable: true),
                    fuel_cost = table.Column<decimal>(type: "numeric", nullable: true),
                    implement = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    nozzles_active = table.Column<int>(type: "integer", nullable: true),
                    fan_state = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    fuel_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    fuel_quantity = table.Column<decimal>(type: "numeric", nullable: true),
                    operation_performed = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    linked_activity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_machinery_usages", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_machinery_usages_daily_log_id",
                schema: "ssf",
                table: "machinery_usages",
                column: "daily_log_id");

            // ── RLS (ADR 0023 §2 — EXISTS-join to daily_logs via daily_log_id, NULLIF) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.machinery_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.machinery_usages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_machinery_usages ON ssf.machinery_usages;
CREATE POLICY p_tenant_machinery_usages ON ssf.machinery_usages
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = machinery_usages.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (true);

DROP POLICY IF EXISTS p_user_select_machinery_usages ON ssf.machinery_usages;
CREATE POLICY p_user_select_machinery_usages ON ssf.machinery_usages
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    JOIN ssf.farms f ON f.""Id"" = d.farm_id
    WHERE d.""Id"" = machinery_usages.daily_log_id
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
DROP POLICY IF EXISTS p_user_select_machinery_usages ON ssf.machinery_usages;
DROP POLICY IF EXISTS p_tenant_machinery_usages ON ssf.machinery_usages;
");

            migrationBuilder.DropTable(
                name: "machinery_usages",
                schema: "ssf");
        }
    }
}
