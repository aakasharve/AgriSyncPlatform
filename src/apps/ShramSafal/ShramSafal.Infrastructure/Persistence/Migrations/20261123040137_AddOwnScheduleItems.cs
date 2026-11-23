// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 schedule slice 3 - a farmer's OWN schedule built one work at a time: <c>ssf.own_schedule_items</c> (the current truth: one row per crop season and
    /// task key, the whole work as canonical task JSON with its hash) and <c>ssf.own_schedule_item_revisions</c> (one unchangeable row per save or removal, P3).
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Two new tables, one trigger function, their policies and grants; no existing
    /// table, column, policy, grant, constraint or row changes. The currently deployed binary never names the new tables, so it runs unchanged against the migrated
    /// schema (P11). No row exists until a phone sends the new mutation names, which the switch refuses for every farm it is not on for.</para>
    ///
    /// <para><b>Row security: farm-keyed on a DIRECT column (F8).</b> An own work belongs to one plot-season of ONE farm, so both tables carry <c>farm_id</c> and use the
    /// farm-keyed shape of <c>20261113090000_AddScheduleStepMoves</c> / <c>20261121032701_AddDfesQuestionContext</c>: FORCE ROW LEVEL SECURITY, <c>p_tenant_{table}</c> on
    /// <c>agrisync.farm_id</c> for every command, plus the Active-member read policy (<c>m.status = 3</c>, or the farm's owner) for a pull that reads every farm of the
    /// caller under his user scope. The history row carries its own <c>farm_id</c> rather than an EXISTS on the item, because EF writes the item and its revision in
    /// ONE <c>SaveChanges</c> and an EXISTS-based <c>WITH CHECK</c> on the child fails 42501 in that batch (F8, tried and reverted elsewhere).</para>
    ///
    /// <para><b>The owner and the place are the farm's, never a writer's (E4).</b> A BEFORE trigger (<c>ssf.enforce_own_schedule_row_place</c>, on INSERT and on an
    /// UPDATE of the place columns) refuses (42501) a row whose <c>owner_user_id</c> is not the owner of <c>farm_id</c> (<c>ssf.farms.owner_user_id</c>) or whose crop
    /// season is not that plot's on that farm. No foreign key, on purpose: a foreign key's check runs outside row security and would tell a caller another farm's id
    /// exists (as <c>schedule_step_moves</c>). After a farm changes owner, a later write names the new owner; the rows already written keep the owner they had (history).</para>
    ///
    /// <para><b>Grants.</b> <c>agrisync_app</c>: SELECT, INSERT, UPDATE on the items (a work is edited in place and its removal is a state; DELETE and TRUNCATE are
    /// revoked); SELECT and INSERT only on the revisions (APPEND-ONLY by privilege). The effective-privilege guard of <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>
    /// REFUSES the migration rather than record success if the app role can still do what is revoked.</para>
    ///
    /// <para><b>Erasure and export.</b> KEEP (ids and the work; see <c>ErasureWorker.cs</c>), proven through the whole worker. Exported with the person's other data
    /// (<c>ExportWorker</c>: the works of the plot-seasons of farms he owns).</para>
    ///
    /// <para><b>Down() REFUSES while any own work or revision exists</b> (<see cref="DownRefusalSql"/>): rolling back would destroy a farmer's own schedule. With none it
    /// drops the two tables and the trigger function, and nothing else. Rolling back past this migration after works were written is a founder decision.</para>
    /// </summary>
    public partial class AddOwnScheduleItems : Migration
    {
        private const string UserScope = "NULLIF(current_setting('agrisync.user_id', true), '')::uuid";
        private const string FarmScope = "NULLIF(current_setting('agrisync.farm_id', true), '')::uuid";

        /// <summary>Spelled out table by table (not templated): the architecture test RlsExemptionAllowlistTests reads these exact statements.</summary>
        internal const string EnableRlsSql = @"
ALTER TABLE ssf.own_schedule_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.own_schedule_items FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.own_schedule_item_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.own_schedule_item_revisions FORCE ROW LEVEL SECURITY;
";

        internal const string TriggerFunctionSql = @"
CREATE OR REPLACE FUNCTION ssf.enforce_own_schedule_row_place() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ssf.farms f WHERE f.""Id"" = NEW.farm_id AND f.owner_user_id = NEW.owner_user_id)
       OR NOT EXISTS (SELECT 1 FROM ssf.crop_cycles c WHERE c.""Id"" = NEW.crop_cycle_id AND c.plot_id = NEW.plot_id AND c.farm_id = NEW.farm_id) THEN
        RAISE EXCEPTION 'an own schedule work names the owner of its farm and a crop season of that farm' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$fn$;
";

        internal static string PolicySql(string table) => (@"
DROP POLICY IF EXISTS p_tenant_{0} ON ssf.{0};
CREATE POLICY p_tenant_{0} ON ssf.{0}
  USING      (farm_id = " + FarmScope + @")
  WITH CHECK (farm_id = " + FarmScope + @");
DROP POLICY IF EXISTS p_user_select_{0} ON ssf.{0};
CREATE POLICY p_user_select_{0} ON ssf.{0}
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = {0}.farm_id
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
DROP TRIGGER IF EXISTS tr_{0}_place ON ssf.{0};
CREATE TRIGGER tr_{0}_place BEFORE INSERT OR UPDATE OF farm_id, plot_id, crop_cycle_id, owner_user_id ON ssf.{0}
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_own_schedule_row_place();
").Replace("{0}", table);

        /// <summary>The grants and the effective-privilege guard for both tables (items: no DELETE / TRUNCATE; revisions: no UPDATE / DELETE / TRUNCATE). Tests execute this same text.</summary>
        internal const string GrantsSql = @"
DO $$
DECLARE
    v_spec     text[];
    v_table    text;
    v_rel      regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; own schedule grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT, UPDATE ON ssf.own_schedule_items TO agrisync_app;
    REVOKE DELETE, TRUNCATE ON ssf.own_schedule_items FROM agrisync_app;
    GRANT SELECT, INSERT ON ssf.own_schedule_item_revisions TO agrisync_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ssf.own_schedule_item_revisions FROM agrisync_app;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    FOREACH v_spec SLICE 1 IN ARRAY ARRAY[
        ARRAY['ssf.own_schedule_items', 'DELETE'],
        ARRAY['ssf.own_schedule_items', 'TRUNCATE'],
        ARRAY['ssf.own_schedule_item_revisions', 'UPDATE'],
        ARRAY['ssf.own_schedule_item_revisions', 'DELETE'],
        ARRAY['ssf.own_schedule_item_revisions', 'TRUNCATE']] LOOP
        v_table := v_spec[1];
        v_priv := v_spec[2];
        v_rel := v_table::regclass;
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

    FOREACH v_table IN ARRAY ARRAY['ssf.own_schedule_items', 'ssf.own_schedule_item_revisions'] LOOP
        v_rel := v_table::regclass;
        SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
        IF pg_has_role('agrisync_app', v_owner, 'MEMBER') THEN
            RAISE WARNING
                '% is owned by % and agrisync_app can act as that owner: statements issued as agrisync_app are refused what is revoked, but the owner can re-grant it and can drop the table. Containment against the owner needs ownership moved to a role agrisync_app is not a member of.',
                v_rel, v_owner;
        END IF;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'own schedule tables still allow agrisync_app what is revoked (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the tables to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>Down()'s refusal (E8). Row security is switched off for the count so a runner subject to it cannot see an empty table where there is none. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_items     bigint;
    v_revisions bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_items FROM ssf.own_schedule_items;
    SELECT count(*) INTO v_revisions FROM ssf.own_schedule_item_revisions;
    IF v_items + v_revisions > 0 THEN
        RAISE EXCEPTION 'Down refused: % own schedule work(s) and % revision(s) exist, and rolling back would destroy them. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_items, v_revisions;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "own_schedule_item_revisions",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    revision_number = table.Column<int>(type: "integer", nullable: false),
                    action = table.Column<short>(type: "smallint", nullable: false),
                    state = table.Column<short>(type: "smallint", nullable: false),
                    content = table.Column<string>(type: "jsonb", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_own_schedule_item_revisions", x => x.id);
                    table.CheckConstraint("ck_own_schedule_item_revisions_hash", "content_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_own_schedule_item_revisions_number", "revision_number >= 1");
                    table.CheckConstraint("ck_own_schedule_item_revisions_state", "state IN (0, 1) AND action IN (0, 1)");
                });

            migrationBuilder.CreateTable(
                name: "own_schedule_items",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    origin = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    content = table.Column<string>(type: "jsonb", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    kind = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    timer_kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    stage_index = table.Column<short>(type: "smallint", nullable: false),
                    order_index = table.Column<int>(type: "integer", nullable: false),
                    state = table.Column<short>(type: "smallint", nullable: false),
                    revision = table.Column<int>(type: "integer", nullable: false),
                    main_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_own_schedule_items", x => x.id);
                    table.CheckConstraint("ck_own_schedule_items_hash", "content_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_own_schedule_items_kind", "kind IN ('irrigation', 'nutrition', 'spray', 'work', 'observe')");
                    table.CheckConstraint("ck_own_schedule_items_revision", "revision >= 1");
                    table.CheckConstraint("ck_own_schedule_items_state", "state IN (0, 1)");
                    table.CheckConstraint("ck_own_schedule_items_timer", "timer_kind IN ('none', 'day', 'after', 'sign')");
                });

            migrationBuilder.CreateIndex(
                name: "ix_own_schedule_item_revisions_farm",
                schema: "ssf",
                table: "own_schedule_item_revisions",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ux_own_schedule_item_revisions_item_number",
                schema: "ssf",
                table: "own_schedule_item_revisions",
                columns: new[] { "item_id", "revision_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_own_schedule_items_farm",
                schema: "ssf",
                table: "own_schedule_items",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_own_schedule_items_plot_season",
                schema: "ssf",
                table: "own_schedule_items",
                columns: new[] { "plot_id", "crop_cycle_id" });

            migrationBuilder.CreateIndex(
                name: "ux_own_schedule_items_season_key",
                schema: "ssf",
                table: "own_schedule_items",
                columns: new[] { "crop_cycle_id", "task_key" },
                unique: true);

            migrationBuilder.Sql(TriggerFunctionSql);
            migrationBuilder.Sql(EnableRlsSql);
            migrationBuilder.Sql(PolicySql("own_schedule_items"));
            migrationBuilder.Sql(PolicySql("own_schedule_item_revisions"));
            migrationBuilder.Sql(GrantsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently erases a farmer's own works. Raises (and so changes nothing) while any exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropTable(
                name: "own_schedule_item_revisions",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "own_schedule_items",
                schema: "ssf");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS ssf.enforce_own_schedule_row_place();");
        }
    }
}
