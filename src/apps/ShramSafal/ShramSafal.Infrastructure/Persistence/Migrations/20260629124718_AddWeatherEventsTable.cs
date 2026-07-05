using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWeatherEventsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "weather_events",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    event_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    severity = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    ts_start = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ts_end = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    signals = table.Column<string>(type: "jsonb", nullable: true),
                    source = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    linked_log_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_weather_events", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_weather_events_farm_id",
                schema: "ssf",
                table: "weather_events",
                column: "farm_id");

            // ── RLS (ADR 0023 §2 — DIRECT farm_id, NULLIF-hardened from day one) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.weather_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.weather_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_weather_events ON ssf.weather_events;
CREATE POLICY p_tenant_weather_events ON ssf.weather_events
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DROP POLICY IF EXISTS p_user_select_weather_events ON ssf.weather_events;
CREATE POLICY p_user_select_weather_events ON ssf.weather_events
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = weather_events.farm_id
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
DROP POLICY IF EXISTS p_user_select_weather_events ON ssf.weather_events;
DROP POLICY IF EXISTS p_tenant_weather_events ON ssf.weather_events;
");

            migrationBuilder.DropTable(
                name: "weather_events",
                schema: "ssf");
        }
    }
}
