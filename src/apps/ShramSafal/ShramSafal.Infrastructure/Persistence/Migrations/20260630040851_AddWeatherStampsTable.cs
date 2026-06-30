using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWeatherStampsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "weather_stamps",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    timestamp_local = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    timestamp_provider = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    provider = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    temp_c = table.Column<decimal>(type: "numeric", nullable: false),
                    humidity = table.Column<decimal>(type: "numeric", nullable: false),
                    wind_kph = table.Column<decimal>(type: "numeric", nullable: false),
                    precip_mm = table.Column<decimal>(type: "numeric", nullable: false),
                    cloud_cover_pct = table.Column<decimal>(type: "numeric", nullable: false),
                    condition_text = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    icon_code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    rain_prob_next_6h = table.Column<decimal>(type: "numeric", nullable: false),
                    wind_gust_kph = table.Column<decimal>(type: "numeric", nullable: true),
                    soil_moisture_0_10 = table.Column<decimal>(type: "numeric", nullable: true),
                    uv_index = table.Column<decimal>(type: "numeric", nullable: true),
                    alerts = table.Column<string>(type: "jsonb", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_weather_stamps", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_weather_stamps_daily_log_id",
                schema: "ssf",
                table: "weather_stamps",
                column: "daily_log_id");

            // ── RLS (ADR 0023 §2 — EXISTS-join to daily_logs via daily_log_id, NULLIF-hardened ADR 0020) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.weather_stamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.weather_stamps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_weather_stamps ON ssf.weather_stamps;
CREATE POLICY p_tenant_weather_stamps ON ssf.weather_stamps
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = weather_stamps.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (true);

DROP POLICY IF EXISTS p_user_select_weather_stamps ON ssf.weather_stamps;
CREATE POLICY p_user_select_weather_stamps ON ssf.weather_stamps
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    JOIN ssf.farms f ON f.""Id"" = d.farm_id
    WHERE d.""Id"" = weather_stamps.daily_log_id
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
DROP POLICY IF EXISTS p_user_select_weather_stamps ON ssf.weather_stamps;
DROP POLICY IF EXISTS p_tenant_weather_stamps ON ssf.weather_stamps;
");

            migrationBuilder.DropTable(
                name: "weather_stamps",
                schema: "ssf");
        }
    }
}
