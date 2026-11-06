// spec: plr-d10-redesign-real-integration-2026-10-25 (lane RATE-1 part A)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 /
    /// D-43): <c>ssf.farm_rates</c>, each farm's OWN price and rate list, one unchangeable row per version of a rate.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE: one new table, nothing else. No existing
    /// column, constraint, policy or grant changes, so the currently deployed binary runs unchanged against the migrated
    /// schema (it never names the table). The new table is FORCE-RLS from birth, tenant-scoped on its own <c>farm_id</c>
    /// (F8), readable by the farm's owner or an ACTIVE member (<c>m.status = 3</c>, the form
    /// <c>20261025204459_RequireActiveMembershipForUserScopedDataReads</c> set) — WHICH member may read WHICH rate (see
    /// money; see wages for a work rate) is the application's rule (<c>FarmRateGate</c>, E4), proved through the pull and
    /// REST as agrisync_app. APPEND-ONLY BY PRIVILEGE: <c>agrisync_app</c> keeps SELECT + INSERT only, with the
    /// effective-privilege guard copied from <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>, which REFUSES the
    /// migration rather than record success if the app role can still UPDATE / DELETE / TRUNCATE. Its CHECKs hold the
    /// closed vocabularies and a positive amount, so no writer can store a rate the app could not read.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops the table and with it every farm's own rate
    /// list and its whole history. No bill, cost entry, wage or job card refers to a rate (the list rewrites nothing), so
    /// nothing else changes — but the farmers' rates are gone from the server, and each phone keeps only the copy it last
    /// pulled. Rolling back past this migration after farmers have set rates is a founder decision.</para>
    /// </summary>
    public partial class AddFarmRates : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.farm_rates
    ADD CONSTRAINT ck_farm_rates_kind CHECK (kind IN ('Input', 'Work')),
    ADD CONSTRAINT ck_farm_rates_basis CHECK (basis IN ('PerUnit', 'PerDay', 'PerHour', 'PerAcre', 'PerTrip', 'PerTask')),
    ADD CONSTRAINT ck_farm_rates_kind_basis CHECK ((kind = 'Input') = (basis = 'PerUnit')),
    ADD CONSTRAINT ck_farm_rates_amount CHECK (amount > 0),
    ADD CONSTRAINT ck_farm_rates_version CHECK (version > 0),
    ADD CONSTRAINT ck_farm_rates_dates CHECK (ends_on IS NULL OR ends_on >= effective_from);

ALTER TABLE ssf.farm_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_farm_rates ON ssf.farm_rates;
CREATE POLICY p_tenant_farm_rates ON ssf.farm_rates
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_farm_rates ON ssf.farm_rates;
CREATE POLICY p_user_select_farm_rates ON ssf.farm_rates
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = farm_rates.farm_id
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
    v_rel      regclass := 'ssf.farm_rates'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; farm-rate grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.farm_rates TO agrisync_app;
    -- A change to a rate is a NEW version, never an edit of a stored one; stopping a rate is a version too (doctrine P3).
    -- TRUNCATE is not a row operation, so RLS never sees it; revoked with UPDATE and DELETE. Revoked only where the app
    -- role holds something (the shape of 20261017080742_EnforceAppendOnlyLedgerGrants).
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.farm_rates FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    -- A membership must never quietly hand the app role UPDATE or DELETE on a farm's rate history.
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
            'ssf.farm_rates is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "farm_rates",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    rate_line_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    item_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    unit = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    basis = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    worker_category = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    currency_code = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    effective_from = table.Column<DateOnly>(type: "date", nullable: false),
                    season = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    ends_on = table.Column<DateOnly>(type: "date", nullable: true),
                    retired = table.Column<bool>(type: "boolean", nullable: false),
                    suggestion_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    client_request_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    app_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_rates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_farm_rates_farms_farm_id",
                        column: x => x.farm_id,
                        principalSchema: "ssf",
                        principalTable: "farms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_farm_rates_farm_created",
                schema: "ssf",
                table: "farm_rates",
                columns: new[] { "farm_id", "created_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ux_farm_rates_line_version",
                schema: "ssf",
                table: "farm_rates",
                columns: new[] { "rate_line_id", "version" },
                unique: true);

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every farm's own rate list and its history go.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_farm_rates ON ssf.farm_rates;
DROP POLICY IF EXISTS p_tenant_farm_rates ON ssf.farm_rates;
");

            migrationBuilder.DropTable(
                name: "farm_rates",
                schema: "ssf");
        }
    }
}
