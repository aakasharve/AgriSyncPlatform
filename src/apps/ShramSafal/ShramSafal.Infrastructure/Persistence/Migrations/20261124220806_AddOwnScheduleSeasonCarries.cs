// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 schedule slice 11 - <c>ssf.own_schedule_season_carries</c>: one answer of the season-end review per work (and per plan-only work picked): the season that ended,
    /// the season carried into, the task, the work of the old season (the previous-item link) and the copy it made, what the farmer said and whether he answered. One row per
    /// (plot, from, to, key); written ONCE and never changed, so the review is asked once per plot-season and a replay or a second phone writes the same rows.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. One new table, its policies, its grants and indexes; the trigger FUNCTION is the one
    /// <c>AddOwnScheduleItems</c> made (<c>ssf.enforce_own_schedule_row_place</c>), reused unchanged; no existing table, column, policy, grant, constraint or row changes. The
    /// currently deployed binary never names the new table, so it runs unchanged against the migrated schema (P11). No row exists until a phone sends
    /// <c>ownschedule.carry_forward</c>, which the switch refuses for every farm it is not on for.</para>
    ///
    /// <para><b>Row security: farm-keyed on a DIRECT column (F8)</b>, exactly the shape of <c>AddOwnScheduleItemOrigins</c>: FORCE ROW LEVEL SECURITY, <c>p_tenant_{table}</c> on
    /// <c>agrisync.farm_id</c> for every command, plus the Active-member read policy (<c>m.status = 3</c>, or the farm's owner) for a pull that reads every farm of the caller under
    /// his user scope. The BEFORE trigger refuses (42501) a row whose <c>owner_user_id</c> is not the owner of <c>farm_id</c> or whose crop season (<c>crop_cycle_id</c>, the one carried
    /// INTO) is not that plot's on that farm. No foreign key, on purpose.</para>
    ///
    /// <para><b>Grants.</b> <c>agrisync_app</c>: SELECT and INSERT only (APPEND-ONLY by privilege). The effective-privilege guard of <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>
    /// REFUSES the migration rather than record success if the app role can still UPDATE, DELETE or TRUNCATE.</para>
    ///
    /// <para><b>Erasure and export.</b> KEEP (opaque ids, a choice and a day); see <c>ErasureWorker.cs</c>.</para>
    ///
    /// <para><b>Down() REFUSES while any row exists</b> (<see cref="DownRefusalSql"/>). With none it drops the table and nothing else.</para>
    /// </summary>
    public partial class AddOwnScheduleSeasonCarries : Migration
    {
        private const string UserScope = "NULLIF(current_setting('agrisync.user_id', true), '')::uuid";
        private const string FarmScope = "NULLIF(current_setting('agrisync.farm_id', true), '')::uuid";

        /// <summary>Spelled out (not templated): the architecture tests read these exact statements.</summary>
        internal const string EnableRlsSql = @"
ALTER TABLE ssf.own_schedule_season_carries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.own_schedule_season_carries FORCE ROW LEVEL SECURITY;
";

        internal const string PolicySql = @"
DROP POLICY IF EXISTS p_tenant_own_schedule_season_carries ON ssf.own_schedule_season_carries;
CREATE POLICY p_tenant_own_schedule_season_carries ON ssf.own_schedule_season_carries
  USING      (farm_id = " + FarmScope + @")
  WITH CHECK (farm_id = " + FarmScope + @");
DROP POLICY IF EXISTS p_user_select_own_schedule_season_carries ON ssf.own_schedule_season_carries;
CREATE POLICY p_user_select_own_schedule_season_carries ON ssf.own_schedule_season_carries
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = own_schedule_season_carries.farm_id
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
DROP TRIGGER IF EXISTS tr_own_schedule_season_carries_place ON ssf.own_schedule_season_carries;
CREATE TRIGGER tr_own_schedule_season_carries_place BEFORE INSERT OR UPDATE OF farm_id, plot_id, crop_cycle_id, owner_user_id ON ssf.own_schedule_season_carries
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_own_schedule_row_place();
";

        /// <summary>The grants and the effective-privilege guard (no UPDATE / DELETE / TRUNCATE for the app role). Tests execute this same text.</summary>
        internal const string GrantsSql = @"
DO $$
DECLARE
    v_priv     text;
    v_rel      regclass := 'ssf.own_schedule_season_carries'::regclass;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; own schedule season carry grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.own_schedule_season_carries TO agrisync_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ssf.own_schedule_season_carries FROM agrisync_app;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
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

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'own schedule season carries still allow agrisync_app what is revoked (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>Down()'s refusal (E8). Row security is switched off for the count so a runner subject to it cannot see an empty table where there is none. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_carries bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_carries FROM ssf.own_schedule_season_carries;
    IF v_carries > 0 THEN
        RAISE EXCEPTION 'Down refused: % own schedule season carry row(s) exist, and rolling back would destroy the farmer's season-end answers and the link of each copy to its previous work. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_carries;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "own_schedule_season_carries",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    previous_item_id = table.Column<Guid>(type: "uuid", nullable: true),
                    new_item_id = table.Column<Guid>(type: "uuid", nullable: true),
                    choice = table.Column<short>(type: "smallint", nullable: false),
                    answered = table.Column<bool>(type: "boolean", nullable: false),
                    recorded_stored_day = table.Column<int>(type: "integer", nullable: true),
                    decided_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    decided_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_own_schedule_season_carries", x => x.id);
                    table.CheckConstraint("ck_own_schedule_season_carries_choice", "choice BETWEEN 0 AND 3");
                });

            migrationBuilder.CreateIndex(
                name: "ix_own_schedule_season_carries_farm",
                schema: "ssf",
                table: "own_schedule_season_carries",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ux_own_schedule_season_carries_pair_key",
                schema: "ssf",
                table: "own_schedule_season_carries",
                columns: new[] { "plot_id", "from_crop_cycle_id", "crop_cycle_id", "task_key" },
                unique: true);

            migrationBuilder.Sql(EnableRlsSql);
            migrationBuilder.Sql(PolicySql);
            migrationBuilder.Sql(GrantsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently erases a farmer's season-end answers. Raises (and so changes nothing) while any row exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropTable(
                name: "own_schedule_season_carries",
                schema: "ssf");
        }
    }
}
