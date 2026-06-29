using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddObservationEventsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "observation_events",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    note_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    severity = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    source = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    text_raw = table.Column<string>(type: "text", nullable: false),
                    text_cleaned = table.Column<string>(type: "text", nullable: true),
                    tags = table.Column<string>(type: "jsonb", nullable: true),
                    linked_activity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_observation_events", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_observation_events_daily_log_id",
                schema: "ssf",
                table: "observation_events",
                column: "daily_log_id");

            // ── RLS (ADR 0023 §2 — EXISTS-join to daily_logs via daily_log_id, NULLIF-hardened ADR 0020) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.observation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.observation_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_observation_events ON ssf.observation_events;
CREATE POLICY p_tenant_observation_events ON ssf.observation_events
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = observation_events.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (true);

DROP POLICY IF EXISTS p_user_select_observation_events ON ssf.observation_events;
CREATE POLICY p_user_select_observation_events ON ssf.observation_events
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    JOIN ssf.farms f ON f.""Id"" = d.farm_id
    WHERE d.""Id"" = observation_events.daily_log_id
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
DROP POLICY IF EXISTS p_user_select_observation_events ON ssf.observation_events;
DROP POLICY IF EXISTS p_tenant_observation_events ON ssf.observation_events;
");

            migrationBuilder.DropTable(
                name: "observation_events",
                schema: "ssf");
        }
    }
}
