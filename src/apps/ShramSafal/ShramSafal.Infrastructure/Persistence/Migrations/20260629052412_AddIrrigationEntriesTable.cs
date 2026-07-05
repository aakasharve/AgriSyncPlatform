using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddIrrigationEntriesTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "irrigation_entries",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    weather_adjusted = table.Column<bool>(type: "boolean", nullable: false),
                    method = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    source = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    duration_hours = table.Column<decimal>(type: "numeric", nullable: true),
                    water_volume_litres = table.Column<decimal>(type: "numeric", nullable: true),
                    linked_activity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_irrigation_entries", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_irrigation_entries_daily_log_id",
                schema: "ssf",
                table: "irrigation_entries",
                column: "daily_log_id");

            // ── RLS (ADR 0023 §2 — EXISTS-join to daily_logs via daily_log_id, NULLIF) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.irrigation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.irrigation_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_irrigation_entries ON ssf.irrigation_entries;
CREATE POLICY p_tenant_irrigation_entries ON ssf.irrigation_entries
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = irrigation_entries.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (true);

DROP POLICY IF EXISTS p_user_select_irrigation_entries ON ssf.irrigation_entries;
CREATE POLICY p_user_select_irrigation_entries ON ssf.irrigation_entries
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    JOIN ssf.farms f ON f.""Id"" = d.farm_id
    WHERE d.""Id"" = irrigation_entries.daily_log_id
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
DROP POLICY IF EXISTS p_user_select_irrigation_entries ON ssf.irrigation_entries;
DROP POLICY IF EXISTS p_tenant_irrigation_entries ON ssf.irrigation_entries;
");

            migrationBuilder.DropTable(
                name: "irrigation_entries",
                schema: "ssf");
        }
    }
}
