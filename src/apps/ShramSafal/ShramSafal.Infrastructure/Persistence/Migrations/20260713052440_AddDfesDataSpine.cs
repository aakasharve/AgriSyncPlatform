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

            // ── daily_richness_aggregates RLS (DIRECT farm_id — copies the
            //    AddRoutinePatternsTable idiom exactly: tenant policy gates
            //    USING + WITH CHECK on agrisync.farm_id; user-select EXISTS-joins
            //    ssf.farms via owner_user_id OR an active farm_membership) ──
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

-- ── question_events RLS — question_events is a DIRECT-farm_id table (its own
--    farm_id column), so it takes the SAME direct-farm_id tenant gate as
--    routine_patterns / daily_richness_aggregates: WITH CHECK gates on
--    agrisync.farm_id (NOT ""true"") so a row can only be inserted for the
--    caller's own scoped farm (trust-critical, per the slice directive). It is
--    additionally append-only by privilege (REVOKE UPDATE/DELETE). ──
ALTER TABLE ssf.question_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.question_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_question_events ON ssf.question_events;
CREATE POLICY p_tenant_question_events ON ssf.question_events
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

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

-- ── GRANTs — without these both tables are silently unwritable ──
--
-- MEASURED, not defensive. 20260515090000_BootstrapDbRoles grants ON ALL TABLES
-- (only those existing at that moment) and ALTER DEFAULT PRIVILEGES FOR ROLE
-- <the role that ran it>. Since the connection split of 2026-05-16, migrations
-- run under the *_Migration connection, so every table created from here on
-- inherits NOTHING and the app role gets 42501 on first write. The same defect
-- is documented at 20260815102440_AddRawBlobSubjects.cs:141-175, which names
-- ssf.field_operators, ssf.field_operator_work_rows and ssf.labour_corrections
-- as already carrying relacl IS NULL for exactly this reason.
--
-- ORDER MATTERS: this must precede the REVOKE below. The REVOKE narrows a real
-- grant down to append-only; without a grant first it revokes nothing from
-- nothing and leaves the app role unable to INSERT at all -- the append-only
-- design would become no-access, silently, and every Sathi question write would
-- fail in production while the migration reported success.
--
-- daily_richness_aggregates takes full CRUD: RecomputeAsync overwrites
-- components_json on every recompute, so it is not append-only.
--
-- Idempotent and role-guarded: a database where the roles were never
-- bootstrapped (some test harnesses) skips instead of failing.
--
-- NOTE (corrected 2026-08-26). An earlier version of this comment justified the
-- GRANTs by claiming migrations run under the *_Migration connection, so every
-- table created here inherits nothing and the app role gets 42501 on first
-- write, citing AddRawBlobSubjects as evidence that field_operators et al carry
-- relacl IS NULL. That cited text was STRUCK in AddRawBlobSubjects on
-- 2026-08-25 -- BOTH HALVES ARE WRONG, measured on production -- and Gate P
-- then measured acl_null=0 across all 77 ssf tables, every one owned by
-- agrisync_app. Startup migrations run on ConnectionStrings__ShramSafalDb,
-- which IS agrisync_app.
--
-- The GRANT statements stay: they are correct and idempotent under either
-- ownership model. Only the reasoning was false, and a false premise that has
-- already been carried forward three times does not get a fourth ride.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.daily_richness_aggregates TO agrisync_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.question_events TO agrisync_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
        GRANT SELECT ON ssf.daily_richness_aggregates TO agrisync_readonly;
        GRANT SELECT ON ssf.question_events TO agrisync_readonly;
    END IF;

    -- Append-only by privilege (mirrors the audit-integrity hardening recipe).
    -- Net effect for question_events after the GRANT above: SELECT + INSERT only.
    --
    -- This sits INSIDE the role guard. It used to sit after `END $$;`, which
    -- meant a database where the roles were never bootstrapped raised
    -- 42704 (role agrisync_app does not exist) -- breaking precisely the
    -- un-bootstrapped throwaway lane where privilege bugs are supposed to be
    -- caught. The guard above is worthless if the statement it guards escapes it.
    --
    -- TRUNCATE is revoked too, and that is not belt-and-braces. TRUNCATE is not
    -- a row operation, so RLS never sees it: one statement from the ordinary app
    -- role erases the entire ledger, tenant policy and all. This exact hole was
    -- found on ssf.audit_events and closed by founder ruling on 2026-08-15
    -- (20260815052139_RevokeTruncateOnAuditEvents); an append-only table that
    -- still grants TRUNCATE is append-only in name only.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.question_events FROM agrisync_app;
    END IF;
END $$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reverse the RLS: restore write grants, then drop every policy.
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
