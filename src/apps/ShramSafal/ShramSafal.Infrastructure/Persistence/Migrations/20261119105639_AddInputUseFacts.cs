using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: facts-card-input-truth-2026-11-19 - lane FACTS slice B (founder 2026-11-19: the amount, the day of the season and the stage
    /// stored in a proper manner, so that at the end of the season the inputs can be sorted and extracted). Three changes, all ADDITIVE:
    /// <list type="number">
    /// <item><c>ssf.application_input_items.method</c> and <c>.carrier_water_litres</c>: how he applied it and the record's carrier
    /// water, as the record states them. Nullable, no default: every existing row reads "not stated" (P4). The currently deployed binary
    /// never names them, so it runs unchanged against the migrated schema (P11).</item>
    /// <item><c>ssf.input_use_facts</c>: one DERIVED row per used product (library product, crop, day zero and where it came from, day of
    /// the season, stage, the library's group codes, and the library and facts-file versions it was derived with, P8).</item>
    /// <item><c>ssf.input_use_ingredients</c>: the ingredients of that use, one row each, so a season can be sorted and counted by ingredient.</item>
    /// </list>
    ///
    /// <para><b>What he said is never rewritten here (P1, P7).</b> The product words, the amount and how sure he was stay in
    /// <c>application_input_items</c>; the two new tables hold only what the server worked out, and a blank is a value that could not be
    /// worked out. Both new tables are FORCE-RLS from birth on their own <c>farm_id</c> (tenant policy), readable by the farm's owner or an
    /// ACTIVE member (<c>m.status = 3</c>) like <c>input_identity_assertions</c>; WHICH member reads WHICH row is the application's rule.</para>
    ///
    /// <para><b>Grants.</b> The rows are derived and rebuildable (P10), so <c>agrisync_app</c> keeps SELECT, INSERT and DELETE (a
    /// re-derivation replaces a use's rows) and never UPDATE or TRUNCATE. Revoked only where the role holds something, and the guard that
    /// refuses the migration if the app role can still UPDATE or TRUNCATE is copied from <c>AddInputIdentityAssertions</c>.</para>
    ///
    /// <para><b>No foreign keys, on purpose.</b> The tables are derived and the demo-farm clear and the test-fixture reset delete farms and
    /// saved records without knowing them; a key would fail those with 23503. The season ledger reads only uses whose record is still the
    /// current version, so a row left behind is never shown.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops both derived tables (rebuildable from the saved records) and
    /// the two columns (the method and carrier water he stated, which a fresh save of the record writes again).</para>
    /// </summary>
    public partial class AddInputUseFacts : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.input_use_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.input_use_facts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_input_use_facts ON ssf.input_use_facts;
CREATE POLICY p_tenant_input_use_facts ON ssf.input_use_facts
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_input_use_facts ON ssf.input_use_facts;
CREATE POLICY p_user_select_input_use_facts ON ssf.input_use_facts
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = input_use_facts.farm_id
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

ALTER TABLE ssf.input_use_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.input_use_ingredients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_input_use_ingredients ON ssf.input_use_ingredients;
CREATE POLICY p_tenant_input_use_ingredients ON ssf.input_use_ingredients
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_input_use_ingredients ON ssf.input_use_ingredients;
CREATE POLICY p_user_select_input_use_ingredients ON ssf.input_use_ingredients
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = input_use_ingredients.farm_id
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
    v_rel      regclass;
    v_tbl      text;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; input-use grants not applicable here.';
        RETURN;
    END IF;

    FOREACH v_tbl IN ARRAY ARRAY['ssf.input_use_facts', 'ssf.input_use_ingredients'] LOOP
        v_rel := v_tbl::regclass;
        -- Derived rows are replaced by a re-derivation (delete + insert), never edited: SELECT, INSERT, DELETE only.
        EXECUTE format('GRANT SELECT, INSERT, DELETE ON %s TO agrisync_app', v_tbl);
        IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
           OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
            EXECUTE format('REVOKE UPDATE, TRUNCATE ON %s FROM agrisync_app', v_tbl);
        END IF;

        -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
        SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
        FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'TRUNCATE'] LOOP
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
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'The input-use tables are still editable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "carrier_water_litres",
                schema: "ssf",
                table: "application_input_items",
                type: "numeric(12,2)",
                precision: 12,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "method",
                schema: "ssf",
                table: "application_input_items",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "input_use_facts",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    operation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    input_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    use_date = table.Column<DateOnly>(type: "date", nullable: false),
                    product_said = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    library_product_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    library_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    facts_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    crop_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    day_zero_date = table.Column<DateOnly>(type: "date", nullable: true),
                    day_zero_source = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    schedule_template_id = table.Column<Guid>(type: "uuid", nullable: true),
                    day_of_season = table.Column<int>(type: "integer", nullable: true),
                    stage_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    group_codes = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    derived_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_input_use_facts", x => x.Id);
                    table.CheckConstraint("ck_input_use_facts_day_of_season", "day_of_season IS NULL OR day_of_season >= 0");
                    table.CheckConstraint("ck_input_use_facts_day_zero_source", "day_zero_source IS NULL OR day_zero_source IN ('schedule', 'crop-cycle-start')");
                });

            migrationBuilder.CreateTable(
                name: "input_use_ingredients",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    input_use_fact_id = table.Column<Guid>(type: "uuid", nullable: false),
                    ordinal = table.Column<int>(type: "integer", nullable: false),
                    ingredient_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ingredient_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ingredient_name_mr = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    percent = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    group_code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_input_use_ingredients", x => x.Id);
                    table.CheckConstraint("ck_input_use_ingredients_ordinal", "ordinal >= 0");
                });

            migrationBuilder.CreateIndex(
                name: "ix_input_use_facts_farm_date",
                schema: "ssf",
                table: "input_use_facts",
                columns: new[] { "farm_id", "use_date" });

            migrationBuilder.CreateIndex(
                name: "ux_input_use_facts_item",
                schema: "ssf",
                table: "input_use_facts",
                column: "input_item_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_input_use_ingredients_fact",
                schema: "ssf",
                table: "input_use_ingredients",
                column: "input_use_fact_id");

            migrationBuilder.CreateIndex(
                name: "ix_input_use_ingredients_farm_key",
                schema: "ssf",
                table: "input_use_ingredients",
                columns: new[] { "farm_id", "ingredient_key" });

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): the derived uses go (rebuildable) and the two stated columns go.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_input_use_ingredients ON ssf.input_use_ingredients;
DROP POLICY IF EXISTS p_tenant_input_use_ingredients ON ssf.input_use_ingredients;
DROP POLICY IF EXISTS p_user_select_input_use_facts ON ssf.input_use_facts;
DROP POLICY IF EXISTS p_tenant_input_use_facts ON ssf.input_use_facts;
");

            migrationBuilder.DropTable(
                name: "input_use_facts",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "input_use_ingredients",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "carrier_water_litres",
                schema: "ssf",
                table: "application_input_items");

            migrationBuilder.DropColumn(
                name: "method",
                schema: "ssf",
                table: "application_input_items");
        }
    }
}
