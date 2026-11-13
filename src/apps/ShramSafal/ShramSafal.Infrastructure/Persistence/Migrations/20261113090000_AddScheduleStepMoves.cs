// spec: plr-d10-redesign-real-integration-2026-10-25 (lane ATT-W; R29 path b, R13, founder L8-C1 note)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 - lane ATT-W (R29, "path b"): <c>ssf.schedule_step_moves</c>, the days a person
    /// chose to be reminded of a step a FOLLOWED schedule asks ("पुढे ठरवा"). A followed schedule's steps are read straight from the days it
    /// stores (the schedule engine's <c>Expand</c>), never written as <c>ssf.planned_activities</c> rows, so a move cannot live on such a
    /// row: one row here says "from schedule day <c>original_date</c>, remind on <c>new_date</c> instead", and the board applies it.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. One new table and nothing else: no column on an existing
    /// table, no existing policy, grant, constraint or row changes, and <c>ssf.planned_activities</c> is NOT touched. The currently deployed
    /// binary never names the table, so it runs unchanged against the migrated schema. FORCE-RLS from birth, tenant-scoped on its own
    /// <c>farm_id</c> (F8, the <c>p_tenant_{table}</c> shape of <c>20260516130000_EnableRowLevelSecurity</c>), plus the Active-member read
    /// policy (<c>m.status = 3</c>, the form <c>20261025204459_RequireActiveMembershipForUserScopedDataReads</c> set) that
    /// <c>20261108090000_AddInputIdentityAssertions</c> and <c>20261107034303_AddRlsToDayLedgersLogTasksAndPlannedActivities</c> write beside
    /// theirs: the attention board reads EVERY farm the caller belongs to in one request under his user scope, so without it a person with two
    /// farms would see no move at all. WHICH member may read WHICH step is the application's rule (the board reads only the plots a seat may
    /// see). APPEND-ONLY BY PRIVILEGE: <c>agrisync_app</c> keeps SELECT + INSERT only, with the effective-privilege guard copied from
    /// <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>, which REFUSES the migration rather than record success if the app role can still
    /// UPDATE / DELETE / TRUNCATE. The latest row per (<c>schedule_subscription_id</c>, <c>template_activity_id</c>, <c>original_date</c>) is
    /// the step's reminder day; every earlier row is history (doctrine P3).</para>
    ///
    /// <para><b>No free text, on purpose.</b> Ids and dates only: no reason column. Today's phone sends one fixed sentence and no founder
    /// answer asks for a typed reason; the move itself (who, when, from which day to which) is the record.</para>
    ///
    /// <para><b>No foreign keys, on purpose (E4).</b> A foreign key's check runs outside row-level security, so a key to a subscription or a
    /// farm would tell a caller another farm's id exists. The application checks the farm, the plot and the subscription under the farm's
    /// own scope (the same answer for another farm's subscription as for a made-up id), as <c>ssf.planned_work</c> does. The demo-farm clear
    /// is therefore not stopped by this table either.</para>
    ///
    /// <para><b>The row holds a person id</b> (<c>moved_by_user_id</c>, opaque) and dates. Erasure: KEEP, see <c>ErasureWorker.cs</c>
    /// (ids and dates only; P6 anonymises the person, never the work).</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops the table: every moved step falls back to the day its
    /// schedule asks it. Nothing else changes (the stage panel and तुलना never read it). Rolling back past this migration after moves exist
    /// is a founder decision.</para>
    /// </summary>
    public partial class AddScheduleStepMoves : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.schedule_step_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_step_moves FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_schedule_step_moves ON ssf.schedule_step_moves;
CREATE POLICY p_tenant_schedule_step_moves ON ssf.schedule_step_moves
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_schedule_step_moves ON ssf.schedule_step_moves;
CREATE POLICY p_user_select_schedule_step_moves ON ssf.schedule_step_moves
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = schedule_step_moves.farm_id
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
    v_rel      regclass := 'ssf.schedule_step_moves'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; schedule-step-move grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.schedule_step_moves TO agrisync_app;
    -- A move is never edited and never removed: a later move is a new row, and the latest one is current (doctrine P3).
    -- TRUNCATE is not a row operation, so RLS never sees it; revoked with UPDATE and DELETE. Revoked only where the app
    -- role holds something (the shape of 20261017080742_EnforceAppendOnlyLedgerGrants).
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.schedule_step_moves FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    -- A membership must never quietly hand the app role UPDATE or DELETE on a farmer's reminder history.
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

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'ssf.schedule_step_moves is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "schedule_step_moves",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_subscription_id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_activity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    original_date = table.Column<DateOnly>(type: "date", nullable: false),
                    new_date = table.Column<DateOnly>(type: "date", nullable: false),
                    moved_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    moved_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_step_moves", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_schedule_step_moves_farm",
                schema: "ssf",
                table: "schedule_step_moves",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_step_moves_step_moved",
                schema: "ssf",
                table: "schedule_step_moves",
                columns: new[] { "schedule_subscription_id", "template_activity_id", "original_date", "moved_at_utc" });

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every moved step falls back to its schedule's own day.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_schedule_step_moves ON ssf.schedule_step_moves;
DROP POLICY IF EXISTS p_tenant_schedule_step_moves ON ssf.schedule_step_moves;
");

            migrationBuilder.DropTable(
                name: "schedule_step_moves",
                schema: "ssf");
        }
    }
}
