// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 - lane L8c-1 (founder D-24c "who may assign; one accountable assignee;
    /// the date is optional; open work stays until done or cancelled", D-24e1 / D-79 "who sees it", D-29 "recorded date is not
    /// the due date"): <c>ssf.planned_work</c> (a task or reminder of one farm) and <c>ssf.planned_work_plots</c> (its plots).
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Two new tables and nothing else: no column on an
    /// existing table, no existing policy, grant, constraint or row changes. The currently deployed binary never names them, so
    /// it runs unchanged against the migrated schema (P11). FORCE-RLS from birth, tenant-scoped on each table's own
    /// <c>farm_id</c> (F8), and readable by the farm's owner or an ACTIVE member (<c>m.status = 3</c>) - WHICH member sees WHICH
    /// task is the application's rule (<c>PlannedWorkVisibility</c>: the maker, the assignee, the primary owner, a holder of
    /// SeeAllTasks), applied by the pull, the REST reads and the audit alike.</para>
    ///
    /// <para><b>No DELETE, ever.</b> <c>agrisync_app</c> keeps SELECT, INSERT and UPDATE; DELETE and TRUNCATE are revoked and
    /// checked by effective privilege with the guard of <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>, which REFUSES the
    /// migration rather than record success if the app role could still delete. A cancelled task is a Cancelled row; a plot taken
    /// off a task is a Dropped row. The row version is the system column <c>xmin</c> (no column is added).</para>
    ///
    /// <para><b>Checks the database keeps.</b> The word lists, at most one of a date and a loose word, a time only with a date,
    /// crew words and a headcount only with an assignee, a headcount of 1 to 999. "A Plot task has one plot row, a MultiPlot task
    /// two or more, a Farm / Unspecified task none" spans two tables, so the Domain keeps it (<c>PlannedWork</c>), not a CHECK.</para>
    ///
    /// <para><b>No foreign key to <c>ssf.farms</c>, on purpose.</b> Like <c>20261108090000_AddInputIdentityAssertions</c>'s record
    /// key, the dev-only demo-farm clear deletes farms and knows nothing of this table; a task's farm is checked by the door
    /// (a farm the sender is not an Active member of never gets a tenant scope) and by the row policy.</para>
    ///
    /// <para><b>The rows hold person ids</b> (maker, assignee, who cancelled) and his words (title, note, crew words). Erasure:
    /// see the KEEP disposition in <c>ErasureWorker.cs</c>.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops both tables: every task and reminder of every
    /// farm, with who made, saw, accepted and cancelled each. The farm's other records are untouched. Rolling back past this
    /// migration after tasks exist is a founder decision.</para>
    /// </summary>
    public partial class AddPlannedWork : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.planned_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.planned_work FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_planned_work ON ssf.planned_work;
CREATE POLICY p_tenant_planned_work ON ssf.planned_work
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_planned_work ON ssf.planned_work;
CREATE POLICY p_user_select_planned_work ON ssf.planned_work
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = planned_work.farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

ALTER TABLE ssf.planned_work_plots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.planned_work_plots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_planned_work_plots ON ssf.planned_work_plots;
CREATE POLICY p_tenant_planned_work_plots ON ssf.planned_work_plots
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_planned_work_plots ON ssf.planned_work_plots;
CREATE POLICY p_user_select_planned_work_plots ON ssf.planned_work_plots
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = planned_work_plots.farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

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
        RAISE NOTICE 'agrisync_app does not exist; planned-work grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT, UPDATE ON ssf.planned_work, ssf.planned_work_plots TO agrisync_app;
    FOREACH v_table IN ARRAY ARRAY['ssf.planned_work', 'ssf.planned_work_plots'] LOOP
        v_rel := v_table::regclass;
        -- A task is never removed: cancelling is a state, taking a plot off is a state. TRUNCATE is not a row operation, so RLS
        -- never sees it; revoked with DELETE. Revoked only where the app role holds something (the shape of
        -- 20261017080742_EnforceAppendOnlyLedgerGrants).
        IF has_table_privilege('agrisync_app', v_rel, 'DELETE')
           OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
            EXECUTE format('REVOKE DELETE, TRUNCATE ON %s FROM agrisync_app', v_table);
        END IF;

        -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
        SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
        FOREACH v_priv IN ARRAY ARRAY['DELETE', 'TRUNCATE'] LOOP
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
                '% is owned by % and agrisync_app can act as that owner: statements issued as agrisync_app are now refused DELETE/TRUNCATE, but the owner can re-grant them and can drop the table. Containment against the owner needs ownership moved to a role agrisync_app is not a member of.',
                v_rel, v_owner;
        END IF;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'planned work is still deletable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the tables to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {

            migrationBuilder.CreateTable(
                name: "planned_work",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    scope = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    planned_date = table.Column<DateOnly>(type: "date", nullable: true),
                    loose_when = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    planned_time = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    assignee_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    crew_text = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    expected_headcount = table.Column<short>(type: "smallint", nullable: true),
                    quantity_text = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    pay_mode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    source = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    source_kind = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: true),
                    source_daily_log_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source_log_task_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source_voice_ref = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    source_plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    recorded_on = table.Column<DateOnly>(type: "date", nullable: false),
                    linked_daily_log_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    seen_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    accepted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    done_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    done_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    cancelled_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    cancelled_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    cancel_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    former_assignee_user_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_planned_work", x => x.id);
                    table.CheckConstraint("ck_planned_work_crew_needs_assignee", "assignee_user_id IS NOT NULL OR (crew_text IS NULL AND expected_headcount IS NULL)");
                    table.CheckConstraint("ck_planned_work_date_or_loose", "planned_date IS NULL OR loose_when IS NULL");
                    table.CheckConstraint("ck_planned_work_headcount", "expected_headcount IS NULL OR (expected_headcount >= 1 AND expected_headcount <= 999)");
                    table.CheckConstraint("ck_planned_work_loose_when", "loose_when IS NULL OR loose_when IN ('Week','Month','Anytime')");
                    table.CheckConstraint("ck_planned_work_pay_mode", "pay_mode IS NULL OR pay_mode IN ('Cash','Daily','Contract','Later')");
                    table.CheckConstraint("ck_planned_work_scope", "scope IN ('Plot','MultiPlot','Farm','Unspecified')");
                    table.CheckConstraint("ck_planned_work_source", "source IN ('Planning','VoiceLog','LogLeftover','Schedule')");
                    table.CheckConstraint("ck_planned_work_source_kind", "source_kind IS NULL OR source_kind IN ('Typed','PlanForm','Spoken','Leftover')");
                    table.CheckConstraint("ck_planned_work_status", "status IN ('Open','Assigned','Seen','Accepted','Done','Cancelled')");
                    table.CheckConstraint("ck_planned_work_time_needs_date", "planned_time IS NULL OR planned_date IS NOT NULL");
                });

            migrationBuilder.CreateTable(
                name: "planned_work_plots",
                schema: "ssf",
                columns: table => new
                {
                    planned_work_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    done_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    done_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    linked_daily_log_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_planned_work_plots", x => new { x.planned_work_id, x.plot_id });
                    table.CheckConstraint("ck_planned_work_plots_status", "status IN ('Pending','Done','Dropped')");
                    table.ForeignKey(
                        name: "FK_planned_work_plots_planned_work_planned_work_id",
                        column: x => x.planned_work_id,
                        principalSchema: "ssf",
                        principalTable: "planned_work",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_planned_work_assignee",
                schema: "ssf",
                table: "planned_work",
                column: "assignee_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_planned_work_creator",
                schema: "ssf",
                table: "planned_work",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_planned_work_farm_modified",
                schema: "ssf",
                table: "planned_work",
                columns: new[] { "farm_id", "modified_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_planned_work_plots_farm",
                schema: "ssf",
                table: "planned_work_plots",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_planned_work_plots_plot",
                schema: "ssf",
                table: "planned_work_plots",
                column: "plot_id");

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every task and reminder goes; the farm's other records are untouched.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_planned_work_plots ON ssf.planned_work_plots;
DROP POLICY IF EXISTS p_tenant_planned_work_plots ON ssf.planned_work_plots;
DROP POLICY IF EXISTS p_user_select_planned_work ON ssf.planned_work;
DROP POLICY IF EXISTS p_tenant_planned_work ON ssf.planned_work;
");

            migrationBuilder.DropTable(
                name: "planned_work_plots",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "planned_work",
                schema: "ssf");
        }
    }
}
