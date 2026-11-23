// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 schedule slice 5 - a farmer's own schedule feeds नियोजन. (1) Seven NULLABLE columns on <c>ssf.planned_work</c> link a plan to the own work it was
    /// made from by a STABLE identity (<c>own_item_id</c> + <c>schedule_task_key</c>, never a step id), say which <c>occurrence</c> it is, what the schedule last said
    /// is due (<c>schedule_due_on</c>), the window it was EXPECTED in (<c>expected_from</c> / <c>expected_to</c>) and the latest answer about its sign
    /// (<c>sign_answer</c>); two partial unique indexes keep one plan per occurrence and ONE OPEN occurrence per work (never a flood; two phones, one plan).
    /// (2) The append-only <c>ssf.schedule_task_events</c>: one row per answer about a work's sign (seen / not yet / unsure).
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. New nullable columns with no default, two partial indexes and two CHECKs that every
    /// existing row satisfies (all its new columns are NULL), one trigger on planned_work that acts only when <c>own_item_id</c> is set, one new table with its
    /// policies and grants. No existing column, policy, grant or row changes. The currently deployed binary never names the new columns or table: its inserts
    /// leave them NULL, which every new rule accepts, so it runs unchanged against the migrated schema (P11).</para>
    ///
    /// <para><b>Row security.</b> planned_work keeps its own farm-keyed FORCE RLS (migration AddPlannedWork). schedule_task_events is farm-keyed on a DIRECT
    /// <c>farm_id</c> (F8) in the shape of <c>20261123040137_AddOwnScheduleItems</c>: FORCE ROW LEVEL SECURITY, <c>p_tenant_*</c> on <c>agrisync.farm_id</c> for
    /// every command, plus the Active-member read policy.</para>
    ///
    /// <para><b>The place is the farm's (E4).</b> BEFORE triggers refuse (42501): a plan whose own work is not a work of the plan's farm with that key
    /// (<c>ssf.enforce_planned_work_own_item</c>), and an answer whose own work is not of its farm, plot, crop season and key
    /// (<c>ssf.enforce_schedule_task_event_place</c>). No foreign key, on purpose (a foreign key's check runs outside row security and would tell a caller another
    /// farm's id exists).</para>
    ///
    /// <para><b>Grants.</b> planned_work: unchanged (SELECT / INSERT / UPDATE). schedule_task_events: SELECT and INSERT only (APPEND-ONLY by privilege); the
    /// effective-privilege guard of <c>20261017080742_EnforceAppendOnlyLedgerGrants</c> REFUSES the migration if the app role can still update, delete or truncate.</para>
    ///
    /// <para><b>Erasure and export.</b> KEEP (opaque ids and the answer; see <c>ErasureWorker.cs</c>), proven through the whole worker. The answers a person gave
    /// are exported (<c>ExportWorker</c>: /schedule_task_events.json).</para>
    ///
    /// <para><b>Down() REFUSES while any plan links an own work or any answer exists</b> (<see cref="DownRefusalSql"/>): rolling back would cut plans from their
    /// work and destroy what was seen. With none it drops exactly what Up added.</para>
    /// </summary>
    public partial class AddScheduleFeed : Migration
    {
        private const string UserScope = "NULLIF(current_setting('agrisync.user_id', true), '')::uuid";
        private const string FarmScope = "NULLIF(current_setting('agrisync.farm_id', true), '')::uuid";

        /// <summary>Spelled out (not templated): the architecture test RlsExemptionAllowlistTests reads these exact statements.</summary>
        internal const string EnableRlsSql = @"
ALTER TABLE ssf.schedule_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_task_events FORCE ROW LEVEL SECURITY;
";

        internal const string TriggerSql = @"
CREATE OR REPLACE FUNCTION ssf.enforce_planned_work_own_item() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.own_item_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ssf.own_schedule_items i
                       WHERE i.id = NEW.own_item_id AND i.farm_id = NEW.farm_id AND i.task_key = NEW.schedule_task_key) THEN
        RAISE EXCEPTION 'a plan from the own schedule names a work of its own farm' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_planned_work_own_item ON ssf.planned_work;
CREATE TRIGGER tr_planned_work_own_item BEFORE INSERT OR UPDATE OF farm_id, own_item_id, schedule_task_key ON ssf.planned_work
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_planned_work_own_item();

CREATE OR REPLACE FUNCTION ssf.enforce_schedule_task_event_place() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ssf.own_schedule_items i
                   WHERE i.id = NEW.own_item_id AND i.farm_id = NEW.farm_id AND i.plot_id = NEW.plot_id
                     AND i.crop_cycle_id = NEW.crop_cycle_id AND i.task_key = NEW.task_key) THEN
        RAISE EXCEPTION 'an answer about a sign names an own work of its farm, plot and crop season' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_schedule_task_events_place ON ssf.schedule_task_events;
CREATE TRIGGER tr_schedule_task_events_place BEFORE INSERT OR UPDATE ON ssf.schedule_task_events
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_schedule_task_event_place();
";

        internal const string PolicySql = @"
DROP POLICY IF EXISTS p_tenant_schedule_task_events ON ssf.schedule_task_events;
CREATE POLICY p_tenant_schedule_task_events ON ssf.schedule_task_events
  USING      (farm_id = " + FarmScope + @")
  WITH CHECK (farm_id = " + FarmScope + @");
DROP POLICY IF EXISTS p_user_select_schedule_task_events ON ssf.schedule_task_events;
CREATE POLICY p_user_select_schedule_task_events ON ssf.schedule_task_events
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = schedule_task_events.farm_id
      AND (
        f.owner_user_id = " + UserScope + @"
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = " + UserScope + @"
            AND m.status = 3
        )
      )
  ));
";

        /// <summary>The grants and the effective-privilege guard (no UPDATE / DELETE / TRUNCATE on the answers). Tests execute this same text.</summary>
        internal const string GrantsSql = @"
DO $$
DECLARE
    v_rel      regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; schedule task event grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.schedule_task_events TO agrisync_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ssf.schedule_task_events FROM agrisync_app;

    v_rel := 'ssf.schedule_task_events'::regclass;
    FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege('agrisync_app', v_rel, v_priv) THEN
            SELECT string_agg(
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                            WHEN a.grantee = 'agrisync_app'::regrole THEN 'agrisync_app (direct grant)'
                            ELSE a.grantee::regrole::text || ' (inherited by membership'
                                 || CASE WHEN a.grantee = c.relowner THEN ', table owner' ELSE '' END || ')'
                       END, ', ')
              INTO v_holders
              FROM pg_class c,
                   aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
             WHERE c.oid = v_rel
               AND a.privilege_type = v_priv
               AND (a.grantee = 0 OR pg_has_role('agrisync_app', a.grantee, 'USAGE'));

            v_failures := v_failures || format(E'\n  %s %s via %s', v_rel, v_priv,
                COALESCE(v_holders, 'superuser (agrisync_app bypasses privilege checks)'));
        END IF;
    END LOOP;

    SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
    IF pg_has_role('agrisync_app', v_owner, 'MEMBER') THEN
        RAISE WARNING
            '% is owned by % and agrisync_app can act as that owner: statements issued as agrisync_app are refused what is revoked, but the owner can re-grant it and can drop the table. Containment against the owner needs ownership moved to a role agrisync_app is not a member of.',
            v_rel, v_owner;
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'schedule_task_events still allows agrisync_app what is revoked (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>Down()'s refusal (E8). Row security is switched off for the count. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_plans  bigint;
    v_events bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_plans FROM ssf.planned_work WHERE own_item_id IS NOT NULL;
    SELECT count(*) INTO v_events FROM ssf.schedule_task_events;
    IF v_plans + v_events > 0 THEN
        RAISE EXCEPTION 'Down refused: % plan(s) made from an own schedule and % answer(s) about a sign exist, and rolling back would cut or destroy them. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_plans, v_events;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "expected_from",
                schema: "ssf",
                table: "planned_work",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "expected_to",
                schema: "ssf",
                table: "planned_work",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "occurrence",
                schema: "ssf",
                table: "planned_work",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "own_item_id",
                schema: "ssf",
                table: "planned_work",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "schedule_due_on",
                schema: "ssf",
                table: "planned_work",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "schedule_task_key",
                schema: "ssf",
                table: "planned_work",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "sign_answer",
                schema: "ssf",
                table: "planned_work",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "schedule_task_events",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    own_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    answer = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    observed_on = table.Column<DateOnly>(type: "date", nullable: false),
                    recorded_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    recorded_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_task_events", x => x.id);
                    table.CheckConstraint("ck_schedule_task_events_answer", "answer IN ('seen', 'not_yet', 'unsure')");
                });

            migrationBuilder.CreateIndex(
                name: "ux_planned_work_own_item_occurrence",
                schema: "ssf",
                table: "planned_work",
                columns: new[] { "own_item_id", "occurrence" },
                unique: true,
                filter: "own_item_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_planned_work_own_item_open",
                schema: "ssf",
                table: "planned_work",
                column: "own_item_id",
                unique: true,
                filter: "own_item_id IS NOT NULL AND status NOT IN ('Done','Cancelled')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_planned_work_own_item_link",
                schema: "ssf",
                table: "planned_work",
                sql: "(own_item_id IS NULL AND schedule_task_key IS NULL AND occurrence IS NULL) OR (own_item_id IS NOT NULL AND schedule_task_key IS NOT NULL AND occurrence >= 1)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_planned_work_sign_answer",
                schema: "ssf",
                table: "planned_work",
                sql: "sign_answer IS NULL OR sign_answer IN ('seen','not_yet','unsure')");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_task_events_farm",
                schema: "ssf",
                table: "schedule_task_events",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_task_events_item",
                schema: "ssf",
                table: "schedule_task_events",
                column: "own_item_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_task_events_plot_season",
                schema: "ssf",
                table: "schedule_task_events",
                columns: new[] { "plot_id", "crop_cycle_id" });

            migrationBuilder.Sql(TriggerSql);
            migrationBuilder.Sql(EnableRlsSql);
            migrationBuilder.Sql(PolicySql);
            migrationBuilder.Sql(GrantsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently cuts a plan from its own work or destroys an answer. Raises (and so changes nothing) while any exists.
            migrationBuilder.Sql(DownRefusalSql);
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS tr_planned_work_own_item ON ssf.planned_work;");

            migrationBuilder.DropTable(
                name: "schedule_task_events",
                schema: "ssf");

            migrationBuilder.DropIndex(
                name: "ux_planned_work_own_item_occurrence",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropIndex(
                name: "ux_planned_work_own_item_open",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropCheckConstraint(
                name: "ck_planned_work_own_item_link",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropCheckConstraint(
                name: "ck_planned_work_sign_answer",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropColumn(
                name: "expected_from",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropColumn(
                name: "expected_to",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropColumn(
                name: "occurrence",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropColumn(
                name: "own_item_id",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropColumn(
                name: "schedule_due_on",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropColumn(
                name: "schedule_task_key",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.DropColumn(
                name: "sign_answer",
                schema: "ssf",
                table: "planned_work");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS ssf.enforce_planned_work_own_item();");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS ssf.enforce_schedule_task_event_place();");
        }
    }
}
