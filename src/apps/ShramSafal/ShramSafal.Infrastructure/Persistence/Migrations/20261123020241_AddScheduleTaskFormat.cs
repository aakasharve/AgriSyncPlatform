// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 schedule slice 2 - the ONE schedule task format, beside the stored activities: <c>ssf.schedule_tasks</c> (the tasks of one version of a schedule),
    /// <c>ssf.schedule_challenges</c> (the challenges of its stages) and two optional columns on <c>ssf.schedule_template_stages</c> (<c>start_sign</c>, <c>end_sign</c>:
    /// the sign a stage starts or ends on, in words).
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Two new tables and two NULLABLE columns; no existing row, column, policy, grant or
    /// constraint changes, and <c>ssf.schedule_templates</c> / <c>template_activities</c> are not touched. The currently deployed binary never names the new
    /// tables or columns and none of its loaders reads them, so it runs unchanged against the migrated schema (P11); every existing version simply has no tasks.
    /// No writer exists yet (the switch is off and slice 2 adds no mutation).</para>
    ///
    /// <para><b>Row security: a direct tenant column, user-keyed (F8; resolved here).</b> A schedule version belongs to no farm (a library row is everyone's; a
    /// person's own schedule is his across every farm he owns, <c>ScheduleViewer</c>), so the farm-keyed shape of <c>AddScheduleStepMoves</c> / <c>AddDfesQuestionContext</c>
    /// has nothing to key on, and an EXISTS-based policy on the parent would fail the batched parent+child insert (F8). So each row carries the two columns the decision needs,
    /// copied from its version: <c>tenant_scope</c> (0 Private, 1 Team, 2 Licensed, 3 Public; a version's scope never changes) and <c>owner_user_id</c> (the person whose
    /// schedule it is: the version's owner, else its maker). FORCE ROW LEVEL SECURITY; two policies on <c>agrisync.user_id</c>:
    /// <list type="bullet">
    /// <item><b>SELECT</b>: a Public row, anyone (also a request that names no person); a row whose owner is the caller; a Team row whose owner owns a farm the caller holds an
    /// ACTIVE seat on (<c>m.status = 3</c>, the form <c>RequireActiveMembershipForUserScopedDataReads</c> set) - exactly <c>ScheduleViewer.MaySeeAsync</c>.</item>
    /// <item><b>INSERT</b>: a row must name an owner, and the caller must be that owner or (Team) on his team. A person is needed (a write with no <c>agrisync.user_id</c> is
    /// refused). The one place the database defends less than the application: a Public row owned by the caller is accepted from any user scope, because the database cannot know who is
    /// staff; the application's <c>ScheduleReview</c> gate is the wall for who writes the library (the library rows have no policy at all today).</item>
    /// </list>
    /// <b>The child can never claim a tenant its version does not have (E4).</b> A foreign key proves a version exists, not that the caller may write to it, and runs
    /// outside row security; so a BEFORE trigger (<c>ssf.enforce_schedule_row_tenant</c>) refuses (42501) a row whose <c>tenant_scope</c> or <c>owner_user_id</c> differs from its
    /// version's (<c>tenant_scope</c>, <c>COALESCE(owner_user_id, created_by_user_id)</c>), or whose version does not exist.</para>
    ///
    /// <para><b>Append-only by privilege.</b> <c>agrisync_app</c> keeps SELECT + INSERT only (UPDATE / DELETE / TRUNCATE revoked), with the effective-privilege guard copied from
    /// <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>: a task is written once with its version and a change is a new version (P3). A version's removal still cascades (the
    /// foreign key runs as the table owner).</para>
    ///
    /// <para><b>Down() REFUSES while any task, challenge or stage sign exists</b> (<see cref="DownRefusalSql"/>): rolling back would destroy them. With none it drops the two
    /// tables, the trigger function and the two columns, and nothing else. Rolling back past this migration after schedules were written in the format is a founder decision.</para>
    /// </summary>
    public partial class AddScheduleTaskFormat : Migration
    {
        private const string UserScope = "NULLIF(current_setting('agrisync.user_id', true), '')::uuid";

        /// <summary>The Team half of the row policy's decision (<c>{0}</c> = the table name): the owner owns a farm the caller holds an active seat on.</summary>
        private const string TeamRule = @"
        (tenant_scope = 1 AND EXISTS (
           SELECT 1 FROM ssf.farms f
           JOIN ssf.farm_memberships m ON m.farm_id = f.""Id""
           WHERE f.owner_user_id = {0}.owner_user_id
             AND m.user_id = " + UserScope + @"
             AND m.status = 3))";

        /// <summary>Spelled out table by table (not templated), because the architecture test RlsExemptionAllowlistTests reads these exact statements to know a table is under row security.</summary>
        internal const string EnableRlsSql = @"
ALTER TABLE ssf.schedule_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_challenges FORCE ROW LEVEL SECURITY;
";

        internal static string PolicySql(string table) => (@"
DROP POLICY IF EXISTS p_read_{0} ON ssf.{0};
CREATE POLICY p_read_{0} ON ssf.{0}
  FOR SELECT
  USING (
    tenant_scope = 3
    OR (owner_user_id IS NOT NULL AND (owner_user_id = " + UserScope + @" OR " + TeamRule + @"))
  );

DROP POLICY IF EXISTS p_insert_{0} ON ssf.{0};
CREATE POLICY p_insert_{0} ON ssf.{0}
  FOR INSERT
  WITH CHECK (
    owner_user_id IS NOT NULL AND (owner_user_id = " + UserScope + @" OR " + TeamRule + @")
  );

DROP TRIGGER IF EXISTS tr_{0}_tenant ON ssf.{0};
CREATE TRIGGER tr_{0}_tenant BEFORE INSERT OR UPDATE ON ssf.{0}
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_schedule_row_tenant();
").Replace("{0}", table);

        internal const string TriggerFunctionSql = @"
CREATE OR REPLACE FUNCTION ssf.enforce_schedule_row_tenant() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    v_scope smallint;
    v_owner uuid;
BEGIN
    SELECT t.tenant_scope::smallint, COALESCE(t.owner_user_id, t.created_by_user_id)
      INTO v_scope, v_owner
      FROM ssf.schedule_templates t
     WHERE t.""Id"" = NEW.schedule_template_id;
    IF NOT FOUND OR v_scope IS DISTINCT FROM NEW.tenant_scope OR v_owner IS DISTINCT FROM NEW.owner_user_id THEN
        RAISE EXCEPTION 'a schedule task or challenge must carry the tenant of its schedule version' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$fn$;
";

        /// <summary>The append-only grants and the effective-privilege guard, for both tables. Tests execute this same text.</summary>
        internal const string GrantsSql = @"
DO $$
DECLARE
    v_table    text;
    v_rel      regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; schedule task grants not applicable here.';
        RETURN;
    END IF;

    FOREACH v_table IN ARRAY ARRAY['ssf.schedule_tasks', 'ssf.schedule_challenges'] LOOP
        v_rel := v_table::regclass;
        EXECUTE format('GRANT SELECT, INSERT ON %s TO agrisync_app', v_table);
        -- A task is written once with its version; a change is a new version (P3). TRUNCATE is not a row operation, so row security never sees it.
        IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
           OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
           OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM agrisync_app', v_table);
        END IF;

        -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
        SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
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

        IF pg_has_role('agrisync_app', v_owner, 'MEMBER') THEN
            RAISE WARNING
                '% is owned by % and agrisync_app can act as that owner: statements issued as agrisync_app are now refused UPDATE/DELETE/TRUNCATE, but the owner can re-grant them and can drop the table. Containment against the owner needs ownership moved to a role agrisync_app is not a member of.',
                v_rel, v_owner;
        END IF;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'schedule task tables are still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the tables to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>Down()'s refusal (E8). Row security is switched off for the count so a runner that is subject to it cannot see an empty table where there is none. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_tasks      bigint;
    v_challenges bigint;
    v_signs      bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_tasks FROM ssf.schedule_tasks;
    SELECT count(*) INTO v_challenges FROM ssf.schedule_challenges;
    SELECT count(*) INTO v_signs FROM ssf.schedule_template_stages WHERE start_sign IS NOT NULL OR end_sign IS NOT NULL;
    IF v_tasks + v_challenges + v_signs > 0 THEN
        RAISE EXCEPTION 'Down refused: % task(s), % challenge(s) and % stage sign(s) exist in the schedule task format, and rolling back would destroy them. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_tasks, v_challenges, v_signs;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "end_sign",
                schema: "ssf",
                table: "schedule_template_stages",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "start_sign",
                schema: "ssf",
                table: "schedule_template_stages",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "schedule_challenges",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_scope = table.Column<short>(type: "smallint", nullable: false),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    challenge_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    stage_index = table.Column<short>(type: "smallint", nullable: false),
                    order_index = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    content = table.Column<string>(type: "jsonb", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_challenges", x => x.id);
                    table.CheckConstraint("ck_schedule_challenges_hash", "content_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_schedule_challenges_scope", "tenant_scope IN (0, 1, 2, 3)");
                    table.CheckConstraint("ck_schedule_challenges_stage_order", "stage_index BETWEEN 0 AND 39 AND order_index BETWEEN 0 AND 9999");
                    table.ForeignKey(
                        name: "FK_schedule_challenges_schedule_templates_schedule_template_id",
                        column: x => x.schedule_template_id,
                        principalSchema: "ssf",
                        principalTable: "schedule_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "schedule_tasks",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_scope = table.Column<short>(type: "smallint", nullable: false),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    task_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    stage_index = table.Column<short>(type: "smallint", nullable: false),
                    order_index = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    kind = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    timer_kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    from_day = table.Column<int>(type: "integer", nullable: true),
                    to_day = table.Column<int>(type: "integer", nullable: true),
                    after_task_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    content = table.Column<string>(type: "jsonb", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_tasks", x => x.id);
                    table.CheckConstraint("ck_schedule_tasks_days", "(from_day IS NULL OR from_day BETWEEN -3650 AND 3650) AND (to_day IS NULL OR to_day BETWEEN -3650 AND 3650)");
                    table.CheckConstraint("ck_schedule_tasks_hash", "content_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_schedule_tasks_kind", "kind IN ('irrigation', 'nutrition', 'spray', 'work', 'observe')");
                    table.CheckConstraint("ck_schedule_tasks_scope", "tenant_scope IN (0, 1, 2, 3)");
                    table.CheckConstraint("ck_schedule_tasks_stage_order", "stage_index BETWEEN 0 AND 39 AND order_index BETWEEN 0 AND 9999");
                    table.CheckConstraint("ck_schedule_tasks_timer", "(timer_kind = 'day' AND from_day IS NOT NULL AND after_task_key IS NULL AND (to_day IS NULL OR to_day >= from_day)) OR (timer_kind = 'after' AND after_task_key IS NOT NULL AND from_day IS NULL AND to_day IS NULL) OR (timer_kind IN ('none', 'sign') AND from_day IS NULL AND to_day IS NULL AND after_task_key IS NULL)");
                    table.ForeignKey(
                        name: "FK_schedule_tasks_schedule_templates_schedule_template_id",
                        column: x => x.schedule_template_id,
                        principalSchema: "ssf",
                        principalTable: "schedule_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_schedule_challenges_owner_user_id",
                schema: "ssf",
                table: "schedule_challenges",
                column: "owner_user_id",
                filter: "owner_user_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_challenges_template_stage",
                schema: "ssf",
                table: "schedule_challenges",
                columns: new[] { "schedule_template_id", "stage_index", "order_index" });

            migrationBuilder.CreateIndex(
                name: "ux_schedule_challenges_template_key",
                schema: "ssf",
                table: "schedule_challenges",
                columns: new[] { "schedule_template_id", "challenge_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_schedule_tasks_owner_user_id",
                schema: "ssf",
                table: "schedule_tasks",
                column: "owner_user_id",
                filter: "owner_user_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_tasks_template_stage",
                schema: "ssf",
                table: "schedule_tasks",
                columns: new[] { "schedule_template_id", "stage_index", "order_index" });

            migrationBuilder.CreateIndex(
                name: "ux_schedule_tasks_template_key",
                schema: "ssf",
                table: "schedule_tasks",
                columns: new[] { "schedule_template_id", "task_key" },
                unique: true);

            migrationBuilder.Sql(TriggerFunctionSql);
            migrationBuilder.Sql(EnableRlsSql);
            migrationBuilder.Sql(PolicySql("schedule_tasks"));
            migrationBuilder.Sql(PolicySql("schedule_challenges"));
            migrationBuilder.Sql(GrantsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently erases a written task, challenge or stage sign. Raises (and so changes nothing) while any exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropTable(
                name: "schedule_challenges",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "schedule_tasks",
                schema: "ssf");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS ssf.enforce_schedule_row_tenant();");

            migrationBuilder.DropColumn(
                name: "end_sign",
                schema: "ssf",
                table: "schedule_template_stages");

            migrationBuilder.DropColumn(
                name: "start_sign",
                schema: "ssf",
                table: "schedule_template_stages");
        }
    }
}
