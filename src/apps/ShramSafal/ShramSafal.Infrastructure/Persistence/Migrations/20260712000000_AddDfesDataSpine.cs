using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDfesDataSpine : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "challenge",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "change",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "comparison",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "crop_stage",
                schema: "ssf",
                table: "observation_events",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "evidence",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "farmer_confirmed_summary",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "hypothesis",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "learning",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "next_action",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "observation",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "source_question_id",
                schema: "ssf",
                table: "observation_events",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "uncertainty",
                schema: "ssf",
                table: "observation_events",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "daily_richness_aggregates",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    local_date = table.Column<DateOnly>(type: "date", nullable: false),
                    time_zone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false, defaultValue: "Asia/Kolkata"),
                    execution_score = table.Column<int>(type: "integer", nullable: true),
                    insight_score = table.Column<int>(type: "integer", nullable: true),
                    learning_score = table.Column<int>(type: "integer", nullable: true),
                    day_classification = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    has_work = table.Column<bool>(type: "boolean", nullable: false),
                    has_meaningful_observation = table.Column<bool>(type: "boolean", nullable: false),
                    has_learning = table.Column<bool>(type: "boolean", nullable: false),
                    has_experiment_outcome = table.Column<bool>(type: "boolean", nullable: false),
                    has_disturbance = table.Column<bool>(type: "boolean", nullable: false),
                    has_declared_no_work_reason = table.Column<bool>(type: "boolean", nullable: false),
                    advances_streak = table.Column<bool>(type: "boolean", nullable: false),
                    advances_bar = table.Column<bool>(type: "boolean", nullable: false),
                    shram_points_earned = table.Column<int>(type: "integer", nullable: false),
                    reward_reasons = table.Column<string>(type: "jsonb", nullable: false),
                    no_work_reason_code = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    expected_stage = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    farmer_confirmed_actual_stage = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    stage_variance_days = table.Column<int>(type: "integer", nullable: true),
                    score_engine_version = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    components_json = table.Column<string>(type: "jsonb", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_daily_richness_aggregates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "question_events",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: true),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    question_key = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    crop = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    expected_stage = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    actual_stage_applicability = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    anchor_date_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    trigger_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    question_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    lens = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    depth_level = table.Column<int>(type: "integer", nullable: false),
                    priority = table.Column<int>(type: "integer", nullable: false),
                    cooldown = table.Column<int>(type: "integer", nullable: false),
                    answer_modes = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    safety_class = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    agronomist_approved = table.Column<bool>(type: "boolean", nullable: false),
                    marathi_approved = table.Column<bool>(type: "boolean", nullable: false),
                    bank_version = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    question_engine_version = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    answer_observation_id = table.Column<Guid>(type: "uuid", nullable: true),
                    shown_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    trigger_reason = table.Column<string>(type: "text", nullable: true),
                    weather_context = table.Column<string>(type: "text", nullable: true),
                    response = table.Column<string>(type: "text", nullable: true),
                    stage_confirmed = table.Column<bool>(type: "boolean", nullable: true),
                    photo_submitted = table.Column<bool>(type: "boolean", nullable: true),
                    skipped = table.Column<bool>(type: "boolean", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_events", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_daily_richness_farm_local_date",
                schema: "ssf",
                table: "daily_richness_aggregates",
                columns: new[] { "farm_id", "local_date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_question_events_daily_log_id",
                schema: "ssf",
                table: "question_events",
                column: "daily_log_id");

            migrationBuilder.CreateIndex(
                name: "ix_question_events_farm_id",
                schema: "ssf",
                table: "question_events",
                column: "farm_id");

            // ── daily_richness_aggregates RLS (copy AddRoutinePatternsTable — DIRECT farm_id) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.daily_richness_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.daily_richness_aggregates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_daily_richness_aggregates ON ssf.daily_richness_aggregates;
CREATE POLICY p_tenant_daily_richness_aggregates ON ssf.daily_richness_aggregates
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DROP POLICY IF EXISTS p_user_select_daily_richness_aggregates ON ssf.daily_richness_aggregates;
CREATE POLICY p_user_select_daily_richness_aggregates ON ssf.daily_richness_aggregates
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = daily_richness_aggregates.farm_id
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

-- ── question_events RLS (copy AddObservationEventsTable append-only shape;
--    tenant anchors on its OWN farm_id column, WITH CHECK (true) so the
--    Phase-5 engine can INSERT; user-select EXISTS-join to farms) ──
ALTER TABLE ssf.question_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.question_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_question_events ON ssf.question_events;
CREATE POLICY p_tenant_question_events ON ssf.question_events
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (true);

DROP POLICY IF EXISTS p_user_select_question_events ON ssf.question_events;
CREATE POLICY p_user_select_question_events ON ssf.question_events
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = question_events.farm_id
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

-- Append-only by privilege (copy HardenAuditIntegrity recipe).
REVOKE UPDATE, DELETE ON ssf.question_events FROM agrisync_app;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
GRANT UPDATE, DELETE ON ssf.question_events TO agrisync_app;
DROP POLICY IF EXISTS p_user_select_question_events ON ssf.question_events;
DROP POLICY IF EXISTS p_tenant_question_events ON ssf.question_events;
DROP POLICY IF EXISTS p_user_select_daily_richness_aggregates ON ssf.daily_richness_aggregates;
DROP POLICY IF EXISTS p_tenant_daily_richness_aggregates ON ssf.daily_richness_aggregates;
");

            migrationBuilder.DropTable(
                name: "daily_richness_aggregates",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "question_events",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "challenge",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "change",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "comparison",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "crop_stage",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "evidence",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "farmer_confirmed_summary",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "hypothesis",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "learning",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "next_action",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "observation",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "source_question_id",
                schema: "ssf",
                table: "observation_events");

            migrationBuilder.DropColumn(
                name: "uncertainty",
                schema: "ssf",
                table: "observation_events");
        }
    }
}
