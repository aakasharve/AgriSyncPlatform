// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9; founder 27 Nov 2026: "send it to server; the phone is only a door; this is the infrastructure")
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 repair D-9 - a farm's SETUP on the server, per farm: <c>ssf.farm_water_sources</c> and <c>ssf.farm_motors</c> (a source with its motors is one
    /// versioned unit), <c>ssf.farm_power_times</c> (one timetable document per farm), <c>ssf.farm_machines</c>, <c>ssf.plot_water_setups</c> (one row per plot that
    /// has ANSWERED the water question) and <c>ssf.plot_water_links</c> (plot to source and motor, many to many).
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Six new tables, one trigger function, their policies, grants and one expression
    /// index; no existing table, column, policy, grant, constraint or row changes. The currently deployed binary never names the new tables, so it runs unchanged
    /// against the migrated schema (P11). No row exists until a phone sends the new <c>farmsetup.*</c> mutation names.</para>
    ///
    /// <para><b>Row security: farm-keyed on a DIRECT column (F8).</b> Every table, child tables too, carries its own <c>farm_id</c> and uses the farm-keyed shape of
    /// <c>20261123040137_AddOwnScheduleItems</c>: FORCE ROW LEVEL SECURITY, <c>p_tenant_{table}</c> on <c>agrisync.farm_id</c> for every command, plus the
    /// Active-member read policy (<c>m.status = 3</c>, or the farm's owner) for a pull that reads every farm of the caller under his user scope. A child carries its
    /// own <c>farm_id</c> rather than an EXISTS on its parent, because EF writes a parent and its children in ONE unit of work and an EXISTS-based
    /// <c>WITH CHECK</c> on the child fails 42501 there (F8).</para>
    ///
    /// <para><b>The place is the farm's, never a writer's (E4).</b> No foreign key, on purpose: a foreign key's check runs outside row security and would tell a
    /// caller another farm's id exists. A BEFORE trigger (<c>ssf.enforce_farm_setup_row_place</c>, on INSERT and on an UPDATE of the place columns) refuses (42501)
    /// a motor whose source is not on the same farm, a plot-water row whose plot is not on the same farm, and a link whose plot, source or motor is not on the
    /// same farm (or whose motor is not a motor of that source). The trigger reads as the writer, under his row security, so another farm's row is nothing to it.</para>
    ///
    /// <para><b>Grants.</b> <c>agrisync_app</c>: SELECT, INSERT, UPDATE on all six. DELETE and TRUNCATE are revoked: a removal is a state (<c>state = 1</c>), the
    /// row stays. The effective-privilege guard of <c>20261017080742_EnforceAppendOnlyLedgerGrants</c> REFUSES the migration rather than record success if the app
    /// role can still do what is revoked.</para>
    ///
    /// <para><b>Erasure and export.</b> KEEP (the rows describe the farm; the user-id columns are opaque ids; see <c>ErasureWorker.cs</c>), proven through the whole
    /// worker. Exported for the farm's owner (<c>ExportWorker</c>: <c>/farm_setup.json</c>).</para>
    ///
    /// <para><b>Down() REFUSES while any row exists</b> (<see cref="DownRefusalSql"/>): rolling back would destroy a farm's setup. With none it drops the six
    /// tables (their policies, triggers and indexes go with them) and the trigger function, and nothing else. Rolling back past this migration after a farm
    /// wrote its setup is a founder decision.</para>
    /// </summary>
    public partial class AddFarmSetup : Migration
    {
        private const string UserScope = "NULLIF(current_setting('agrisync.user_id', true), '')::uuid";
        private const string FarmScope = "NULLIF(current_setting('agrisync.farm_id', true), '')::uuid";

        /// <summary>Spelled out table by table (not templated): the architecture test RlsExemptionAllowlistTests reads these exact statements.</summary>
        internal const string EnableRlsSql = @"
ALTER TABLE ssf.farm_water_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_water_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_motors ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_motors FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_power_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_power_times FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_machines FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.plot_water_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.plot_water_setups FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.plot_water_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.plot_water_links FORCE ROW LEVEL SECURITY;
";

        /// <summary>One function for the three tables that point at another row: which check runs is chosen by the table the trigger sits on.</summary>
        internal const string TriggerFunctionSql = @"
CREATE OR REPLACE FUNCTION ssf.enforce_farm_setup_row_place() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_TABLE_NAME = 'farm_motors' THEN
        IF NOT EXISTS (SELECT 1 FROM ssf.farm_water_sources s WHERE s.id = NEW.water_source_id AND s.farm_id = NEW.farm_id) THEN
            RAISE EXCEPTION 'a motor belongs to a water source of its own farm' USING ERRCODE = '42501';
        END IF;
    ELSIF TG_TABLE_NAME = 'plot_water_setups' THEN
        IF NOT EXISTS (SELECT 1 FROM ssf.plots p WHERE p.""Id"" = NEW.plot_id AND p.farm_id = NEW.farm_id) THEN
            RAISE EXCEPTION 'a plot water arrangement names a plot of its own farm' USING ERRCODE = '42501';
        END IF;
    ELSIF TG_TABLE_NAME = 'plot_water_links' THEN
        IF NOT EXISTS (SELECT 1 FROM ssf.plots p WHERE p.""Id"" = NEW.plot_id AND p.farm_id = NEW.farm_id)
           OR NOT EXISTS (SELECT 1 FROM ssf.farm_water_sources s WHERE s.id = NEW.water_source_id AND s.farm_id = NEW.farm_id)
           OR (NEW.motor_id IS NOT NULL AND NOT EXISTS (
                   SELECT 1 FROM ssf.farm_motors m
                   WHERE m.id = NEW.motor_id AND m.farm_id = NEW.farm_id AND m.water_source_id = NEW.water_source_id)) THEN
            RAISE EXCEPTION 'a plot water link names a plot, a water source and a motor of that source, all of its own farm' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END
$fn$;
";

        /// <summary>The place triggers of the three tables that point at another row (the columns named are the ones the check reads).</summary>
        internal const string TriggersSql = @"
DROP TRIGGER IF EXISTS tr_farm_motors_place ON ssf.farm_motors;
CREATE TRIGGER tr_farm_motors_place BEFORE INSERT OR UPDATE OF farm_id, water_source_id ON ssf.farm_motors
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_farm_setup_row_place();
DROP TRIGGER IF EXISTS tr_plot_water_setups_place ON ssf.plot_water_setups;
CREATE TRIGGER tr_plot_water_setups_place BEFORE INSERT OR UPDATE OF farm_id, plot_id ON ssf.plot_water_setups
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_farm_setup_row_place();
DROP TRIGGER IF EXISTS tr_plot_water_links_place ON ssf.plot_water_links;
CREATE TRIGGER tr_plot_water_links_place BEFORE INSERT OR UPDATE OF farm_id, plot_id, water_source_id, motor_id ON ssf.plot_water_links
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_farm_setup_row_place();
";

        /// <summary>
        /// One link per (plot, source, motor-or-none). An expression index (a NULL motor is one value here), so it is written by hand: the model cannot say it.
        /// </summary>
        internal const string PairIndexSql = @"
CREATE UNIQUE INDEX IF NOT EXISTS ux_plot_water_links_pair
  ON ssf.plot_water_links (plot_id, water_source_id, COALESCE(motor_id, '00000000-0000-0000-0000-000000000000'::uuid));
";

        /// <summary>The two standard policies of one table, the same text as <c>AddOwnScheduleItems.PolicySql</c> without its trigger.</summary>
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
").Replace("{0}", table);

        /// <summary>The grants and the effective-privilege guard for the six tables (no DELETE, no TRUNCATE: a removal is a state). Tests execute this same text.</summary>
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
        RAISE NOTICE 'agrisync_app does not exist; farm setup grants not applicable here.';
        RETURN;
    END IF;

    FOREACH v_table IN ARRAY ARRAY['ssf.farm_water_sources', 'ssf.farm_motors', 'ssf.farm_power_times', 'ssf.farm_machines',
                                   'ssf.plot_water_setups', 'ssf.plot_water_links'] LOOP
        v_rel := v_table::regclass;
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %s TO agrisync_app', v_rel);
        EXECUTE format('REVOKE DELETE, TRUNCATE ON %s FROM agrisync_app', v_rel);

        -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
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

        SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
        IF pg_has_role('agrisync_app', v_owner, 'MEMBER') THEN
            RAISE WARNING
                '% is owned by % and agrisync_app can act as that owner: statements issued as agrisync_app are refused what is revoked, but the owner can re-grant it and can drop the table. Containment against the owner needs ownership moved to a role agrisync_app is not a member of.',
                v_rel, v_owner;
        END IF;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'farm setup tables still allow agrisync_app what is revoked (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the tables to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>Down()'s refusal (E8). Row security is switched off for the count so a runner subject to it cannot see an empty table where there is none. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_sources  bigint;
    v_motors   bigint;
    v_times    bigint;
    v_machines bigint;
    v_setups   bigint;
    v_links    bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_sources FROM ssf.farm_water_sources;
    SELECT count(*) INTO v_motors FROM ssf.farm_motors;
    SELECT count(*) INTO v_times FROM ssf.farm_power_times;
    SELECT count(*) INTO v_machines FROM ssf.farm_machines;
    SELECT count(*) INTO v_setups FROM ssf.plot_water_setups;
    SELECT count(*) INTO v_links FROM ssf.plot_water_links;
    IF v_sources + v_motors + v_times + v_machines + v_setups + v_links > 0 THEN
        RAISE EXCEPTION 'Down refused: % farm setup row(s) exist (% water source(s), % motor(s), % power timetable(s), % machine(s), % plot water answer(s), % plot water link(s)), and rolling back would destroy them. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.',
            v_sources + v_motors + v_times + v_machines + v_setups + v_links, v_sources, v_motors, v_times, v_machines, v_setups, v_links;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "farm_machines",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    machine_type = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    ownership = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    company = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    model = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    hp = table.Column<decimal>(type: "numeric(6,2)", nullable: true),
                    nozzle_count = table.Column<short>(type: "smallint", nullable: true),
                    tank_litres = table.Column<decimal>(type: "numeric(8,2)", nullable: true),
                    detail_line = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    state = table.Column<short>(type: "smallint", nullable: false),
                    revision = table.Column<int>(type: "integer", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_machines", x => x.id);
                    table.CheckConstraint("ck_farm_machines_hp", "hp > 0");
                    table.CheckConstraint("ck_farm_machines_nozzles", "nozzle_count > 0");
                    table.CheckConstraint("ck_farm_machines_ownership", "ownership IN ('owned', 'rented')");
                    table.CheckConstraint("ck_farm_machines_revision", "revision >= 1");
                    table.CheckConstraint("ck_farm_machines_state", "state IN (0, 1)");
                    table.CheckConstraint("ck_farm_machines_tank", "tank_litres > 0");
                    table.CheckConstraint("ck_farm_machines_type", "machine_type IN ('tractor', 'blower', 'sprayer', 'rotavator', 'harvester', 'other')");
                });

            migrationBuilder.CreateTable(
                name: "farm_motors",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    water_source_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    hp = table.Column<decimal>(type: "numeric(6,2)", nullable: false),
                    phase = table.Column<short>(type: "smallint", nullable: false),
                    power_source = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    power_source_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    has_drip = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    drip_pipe_size = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    drip_has_filter = table.Column<bool>(type: "boolean", nullable: true),
                    drip_flow_lph = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    state = table.Column<short>(type: "smallint", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_motors", x => x.id);
                    table.CheckConstraint("ck_farm_motors_drip_flow", "drip_flow_lph > 0");
                    table.CheckConstraint("ck_farm_motors_hp", "hp > 0 AND hp <= 500");
                    table.CheckConstraint("ck_farm_motors_phase", "phase IN (1, 3)");
                    table.CheckConstraint("ck_farm_motors_power_source", "power_source IN ('mseb', 'solar', 'generator')");
                    table.CheckConstraint("ck_farm_motors_state", "state IN (0, 1)");
                });

            migrationBuilder.CreateTable(
                name: "farm_power_times",
                schema: "ssf",
                columns: table => new
                {
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    content = table.Column<string>(type: "jsonb", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    revision = table.Column<int>(type: "integer", nullable: false),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_power_times", x => x.farm_id);
                    table.CheckConstraint("ck_farm_power_times_hash", "content_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_farm_power_times_revision", "revision >= 1");
                });

            migrationBuilder.CreateTable(
                name: "farm_water_sources",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    source_type = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    is_available = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    notes = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    state = table.Column<short>(type: "smallint", nullable: false),
                    revision = table.Column<int>(type: "integer", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_water_sources", x => x.id);
                    table.CheckConstraint("ck_farm_water_sources_revision", "revision >= 1");
                    table.CheckConstraint("ck_farm_water_sources_state", "state IN (0, 1)");
                    table.CheckConstraint("ck_farm_water_sources_type", "source_type IN ('well', 'borewell', 'canal', 'farm_pond', 'tanker')");
                });

            migrationBuilder.CreateTable(
                name: "plot_water_links",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    water_source_id = table.Column<Guid>(type: "uuid", nullable: false),
                    motor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    state = table.Column<short>(type: "smallint", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_plot_water_links", x => x.id);
                    table.CheckConstraint("ck_plot_water_links_state", "state IN (0, 1)");
                });

            migrationBuilder.CreateTable(
                name: "plot_water_setups",
                schema: "ssf",
                columns: table => new
                {
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    irrigation_method = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    revision = table.Column<int>(type: "integer", nullable: false),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_plot_water_setups", x => x.plot_id);
                    table.CheckConstraint("ck_plot_water_setups_method", "irrigation_method IN ('drip', 'flood', 'sprinkler', 'none')");
                    table.CheckConstraint("ck_plot_water_setups_revision", "revision >= 1");
                });

            migrationBuilder.CreateIndex(
                name: "ix_farm_machines_farm",
                schema: "ssf",
                table: "farm_machines",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_farm_motors_farm",
                schema: "ssf",
                table: "farm_motors",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_farm_motors_source",
                schema: "ssf",
                table: "farm_motors",
                column: "water_source_id");

            migrationBuilder.CreateIndex(
                name: "ix_farm_water_sources_farm",
                schema: "ssf",
                table: "farm_water_sources",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_plot_water_links_farm",
                schema: "ssf",
                table: "plot_water_links",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_plot_water_links_motor",
                schema: "ssf",
                table: "plot_water_links",
                column: "motor_id");

            migrationBuilder.CreateIndex(
                name: "ix_plot_water_links_plot",
                schema: "ssf",
                table: "plot_water_links",
                column: "plot_id");

            migrationBuilder.CreateIndex(
                name: "ix_plot_water_setups_farm",
                schema: "ssf",
                table: "plot_water_setups",
                column: "farm_id");

            migrationBuilder.Sql(PairIndexSql);
            migrationBuilder.Sql(TriggerFunctionSql);
            migrationBuilder.Sql(EnableRlsSql);
            migrationBuilder.Sql(PolicySql("farm_water_sources"));
            migrationBuilder.Sql(PolicySql("farm_motors"));
            migrationBuilder.Sql(PolicySql("farm_power_times"));
            migrationBuilder.Sql(PolicySql("farm_machines"));
            migrationBuilder.Sql(PolicySql("plot_water_setups"));
            migrationBuilder.Sql(PolicySql("plot_water_links"));
            migrationBuilder.Sql(TriggersSql);
            migrationBuilder.Sql(GrantsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently erases a farm's setup. Raises (and so changes nothing) while any row exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropTable(
                name: "farm_machines",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "farm_motors",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "farm_power_times",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "farm_water_sources",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "plot_water_links",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "plot_water_setups",
                schema: "ssf");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS ssf.enforce_farm_setup_row_place();");
        }
    }
}
