// spec: plr-d10-redesign-real-integration-2026-10-25 (lane BILL-1)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who
    /// and when"): <c>ssf.cost_entries.content_version</c> (which version of a bill this is) and
    /// <c>ssf.cost_entry_approvals</c>, a bill's मंजूर stamps, one unchangeable row each (who, when, which version).
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. One column on <c>ssf.cost_entries</c>,
    /// <c>NOT NULL DEFAULT 1</c> (a metadata-only add on Postgres 11+, no rewrite): every bill saved before it is version 1,
    /// which is true — nobody had approved any bill, so no stamp can name an older number for it. The currently deployed
    /// binary never names the column, and its inserts take the default, so it runs unchanged against the migrated schema.
    /// One new table, FORCE-RLS from birth, tenant-scoped on its own <c>farm_id</c> (F8), readable by the farm's owner or an
    /// ACTIVE member (<c>m.status = 3</c>, the form <c>20261025204459_RequireActiveMembershipForUserScopedDataReads</c> set) —
    /// WHICH member may read WHICH stamp is the application's rule (a stamp travels only with a bill he receives, E4).
    /// APPEND-ONLY BY PRIVILEGE: <c>agrisync_app</c> keeps SELECT + INSERT only, with the effective-privilege guard copied
    /// from <c>20261017080742_EnforceAppendOnlyLedgerGrants</c> (as <c>20261106112244_AddFarmRates</c> does), which REFUSES
    /// the migration rather than record success if the app role can still UPDATE / DELETE / TRUNCATE. No existing policy,
    /// grant or constraint changes.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops the table — every bill's मंजूर stamps and
    /// their history — and the version column. The bills, their corrections and their flags are untouched (a stamp never
    /// changed them), so every bill reads "not approved" again and its review flag is open again. Rolling back past this
    /// migration after reviewers have approved bills is a founder decision.</para>
    /// </summary>
    public partial class AddCostEntryApprovals : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.cost_entry_approvals
    ADD CONSTRAINT ck_cost_entry_approvals_bill_version CHECK (bill_version > 0);

ALTER TABLE ssf.cost_entry_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.cost_entry_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_cost_entry_approvals ON ssf.cost_entry_approvals;
CREATE POLICY p_tenant_cost_entry_approvals ON ssf.cost_entry_approvals
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_cost_entry_approvals ON ssf.cost_entry_approvals;
CREATE POLICY p_user_select_cost_entry_approvals ON ssf.cost_entry_approvals
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = cost_entry_approvals.farm_id
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
    v_rel      regclass := 'ssf.cost_entry_approvals'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; cost-entry-approval grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.cost_entry_approvals TO agrisync_app;
    -- A stamp is never edited and never removed: a later correction makes a new version of the bill, and the stamp then
    -- reads as being for the older one (doctrine P3).
    -- TRUNCATE is not a row operation, so RLS never sees it; revoked with UPDATE and DELETE. Revoked only where the app
    -- role holds something (the shape of 20261017080742_EnforceAppendOnlyLedgerGrants).
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.cost_entry_approvals FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    -- A membership must never quietly hand the app role UPDATE or DELETE on a bill's approval history.
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
            'ssf.cost_entry_approvals is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "content_version",
                schema: "ssf",
                table: "cost_entries",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "cost_entry_approvals",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    cost_entry_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bill_version = table.Column<int>(type: "integer", nullable: false),
                    approved_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    approved_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    client_request_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    app_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cost_entry_approvals", x => x.Id);
                    table.ForeignKey(
                        name: "FK_cost_entry_approvals_cost_entries_cost_entry_id",
                        column: x => x.cost_entry_id,
                        principalSchema: "ssf",
                        principalTable: "cost_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_cost_entry_approvals_farms_farm_id",
                        column: x => x.farm_id,
                        principalSchema: "ssf",
                        principalTable: "farms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_cost_entry_approvals_entry_approved",
                schema: "ssf",
                table: "cost_entry_approvals",
                columns: new[] { "cost_entry_id", "approved_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_cost_entry_approvals_farm_id",
                schema: "ssf",
                table: "cost_entry_approvals",
                column: "farm_id");

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every bill's approval stamps go; the bills are untouched.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_cost_entry_approvals ON ssf.cost_entry_approvals;
DROP POLICY IF EXISTS p_tenant_cost_entry_approvals ON ssf.cost_entry_approvals;
");

            migrationBuilder.DropTable(
                name: "cost_entry_approvals",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "content_version",
                schema: "ssf",
                table: "cost_entries");
        }
    }
}
