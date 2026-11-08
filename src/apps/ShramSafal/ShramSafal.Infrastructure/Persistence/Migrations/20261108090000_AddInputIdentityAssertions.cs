// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: dfes-input-truth-and-mix-check-2026-11-06 - lane IT2 (founders D-92 "his answers go in a SEPARATE append-only
    /// table; an answer never re-opens or changes a confirmed record" and D-95 "the server sets is_check, never the phone"):
    /// <c>ssf.input_identity_assertions</c>, his हो / नाही / फोटो answers about the products of saved records, one unchangeable
    /// row each (the record and item, his words copied from the stored record, the library product, the answer, the library
    /// version, who gave it, when, the sync request, and whether it is the check).
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. One new table and nothing else: no column on an
    /// existing table, no existing policy, grant, constraint or row changes. The currently deployed binary never names the table,
    /// so it runs unchanged against the migrated schema. FORCE-RLS from birth, tenant-scoped on its own <c>farm_id</c> (F8), and
    /// readable by the farm's owner or an ACTIVE member (<c>m.status = 3</c>, the form
    /// <c>20261025204459_RequireActiveMembershipForUserScopedDataReads</c> set) - WHICH member may read WHICH answer is the
    /// application's rule (an answer travels only with a record he may see, E4). APPEND-ONLY BY PRIVILEGE: <c>agrisync_app</c>
    /// keeps SELECT + INSERT only, with the effective-privilege guard copied from
    /// <c>20261017080742_EnforceAppendOnlyLedgerGrants</c> (as <c>20261106221812_AddCostEntryApprovals</c> does), which REFUSES the
    /// migration rather than record success if the app role can still UPDATE / DELETE / TRUNCATE. The newest row for the same item
    /// (<c>daily_log_id</c>, <c>input_event_id</c>, <c>mix_index</c>) is the current answer, read by <c>asserted_at_utc</c>. A unique
    /// key on (<c>farm_id</c>, <c>client_mutation_id</c>) makes a re-sent answer the same row.</para>
    ///
    /// <para><b>No foreign key to <c>ssf.daily_logs</c>, on purpose.</b> The demo-farm clear and the test-fixture reset delete saved
    /// records and know nothing of this table, so a RESTRICT key would fail them with 23503 the day a farm answers a product. The
    /// application checks the record instead: it reads it under the sender's scope, and an answer's farm is its record's farm (E4);
    /// the pull re-checks both before it sends a row.</para>
    ///
    /// <para><b>The key to <c>ssf.farms</c> is RESTRICT, and one tool deletes a farm.</b> The Bootstrapper's
    /// <c>PurveshDemoSeeder.ClearPurveshDemoAsync</c> (a dev-only clear, outside this lane and not changed by it) removes the demo
    /// farm's row, so once an answer exists on the demo farm that clear fails loudly with 23503 until the answers are removed
    /// through the admin path first (it already does this for a bill's stamps). An answer needs a stored content item and the clear
    /// already refuses a farm that holds content rows, with its own message, so it normally stops there first. No other code deletes
    /// a farm.</para>
    ///
    /// <para><b>The row holds a person id</b> (<c>asserted_by_user_id</c>, opaque) and a copy of the product name he said
    /// (<c>spoken_name</c>, a value, not his words: the content document's <c>WordKeys</c> do not include it). Erasure: see the
    /// KEEP disposition in <c>ErasureWorker.cs</c>.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops the table - every answer he gave about every
    /// product of every record, and who checked it. The records themselves are untouched (an answer never changed them), so every
    /// product reads "not answered" again. Rolling back past this migration after answers exist is a founder decision.</para>
    /// </summary>
    public partial class AddInputIdentityAssertions : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.input_identity_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.input_identity_assertions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_input_identity_assertions ON ssf.input_identity_assertions;
CREATE POLICY p_tenant_input_identity_assertions ON ssf.input_identity_assertions
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_input_identity_assertions ON ssf.input_identity_assertions;
CREATE POLICY p_user_select_input_identity_assertions ON ssf.input_identity_assertions
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = input_identity_assertions.farm_id
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
    v_rel      regclass := 'ssf.input_identity_assertions'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; input-identity-assertion grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.input_identity_assertions TO agrisync_app;
    -- An answer is never edited and never removed: a later answer is a new row, and the newest one is current (doctrine P3).
    -- TRUNCATE is not a row operation, so RLS never sees it; revoked with UPDATE and DELETE. Revoked only where the app
    -- role holds something (the shape of 20261017080742_EnforceAppendOnlyLedgerGrants).
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.input_identity_assertions FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    -- A membership must never quietly hand the app role UPDATE or DELETE on a farmer's answers.
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
            'ssf.input_identity_assertions is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "input_identity_assertions",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    input_event_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    mix_index = table.Column<int>(type: "integer", nullable: false),
                    spoken_name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    catalog_product_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    verdict = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    attachment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    catalog_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asserted_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    asserted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    client_mutation_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    is_check = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_input_identity_assertions", x => x.Id);
                    table.CheckConstraint("ck_input_identity_assertions_confirmed_has_product", "verdict <> 'confirmed' OR catalog_product_id IS NOT NULL");
                    table.CheckConstraint("ck_input_identity_assertions_mix_index", "mix_index >= 0");
                    table.CheckConstraint("ck_input_identity_assertions_verdict", "verdict IN ('confirmed', 'rejected', 'photo')");
                    table.ForeignKey(
                        name: "FK_input_identity_assertions_farms_farm_id",
                        column: x => x.farm_id,
                        principalSchema: "ssf",
                        principalTable: "farms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_input_identity_assertions_farm_asserted",
                schema: "ssf",
                table: "input_identity_assertions",
                columns: new[] { "farm_id", "asserted_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_input_identity_assertions_item_asserted",
                schema: "ssf",
                table: "input_identity_assertions",
                columns: new[] { "daily_log_id", "input_event_id", "mix_index", "asserted_at_utc" },
                descending: new[] { false, false, false, true });

            migrationBuilder.CreateIndex(
                name: "ux_input_identity_assertions_farm_mutation",
                schema: "ssf",
                table: "input_identity_assertions",
                columns: new[] { "farm_id", "client_mutation_id" },
                unique: true);

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every answer and every check goes; the records are untouched.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_input_identity_assertions ON ssf.input_identity_assertions;
DROP POLICY IF EXISTS p_tenant_input_identity_assertions ON ssf.input_identity_assertions;
");

            migrationBuilder.DropTable(
                name: "input_identity_assertions",
                schema: "ssf");
        }
    }
}
