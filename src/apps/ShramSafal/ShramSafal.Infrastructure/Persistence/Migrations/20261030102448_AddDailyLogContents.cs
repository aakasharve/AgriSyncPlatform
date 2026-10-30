using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — <c>ssf.daily_log_contents</c>:
    /// what Sathi understood for a log, one unchangeable row per record version.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE: one new table and one
    /// new NULLABLE column on <c>ssf.daily_logs</c> (<c>capture_scope</c>, no default, no back-fill —
    /// review N12: "labour" for a हजेरी-door save, NULL otherwise and for every older row). No existing
    /// column, constraint or policy changes, so the currently deployed binary runs unchanged against
    /// the migrated schema (it never names the table, and inserts without the column). The new table is
    /// FORCE-RLS from birth, tenant-scoped on its own <c>farm_id</c> (F8), readable by the farm's
    /// owner or an ACTIVE member (<c>m.status = 3</c>, the form
    /// <c>20261025204459_RequireActiveMembershipForUserScopedDataReads</c> set), and APPEND-ONLY BY
    /// PRIVILEGE: <c>agrisync_app</c> keeps SELECT + INSERT only, with the effective-privilege guard
    /// copied from <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>, which REFUSES the migration
    /// rather than record success if the app role can still UPDATE / DELETE / TRUNCATE.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops the table, and with it
    /// every stored detail. Each phone keeps its own copies of the logs it made, and other phones
    /// fall back to showing the task lines with nothing made up — but the server's copy is gone.
    /// It also drops <c>daily_logs.capture_scope</c>: which records came from the हजेरी door is forgotten.
    /// Rolling back past this migration after phones have used it is a founder decision.</para>
    /// </summary>
    public partial class AddDailyLogContents : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.daily_log_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.daily_log_contents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_daily_log_contents ON ssf.daily_log_contents;
CREATE POLICY p_tenant_daily_log_contents ON ssf.daily_log_contents
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_daily_log_contents ON ssf.daily_log_contents;
CREATE POLICY p_user_select_daily_log_contents ON ssf.daily_log_contents
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = daily_log_contents.farm_id
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
    v_rel      regclass := 'ssf.daily_log_contents'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; daily-log-content grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.daily_log_contents TO agrisync_app;
    -- A change to what was said is a NEW version, never an edit of a stored one (doctrine P3).
    -- TRUNCATE is not a row operation, so RLS never sees it; revoked with UPDATE and DELETE.
    -- Revoked only where the app role holds something (a REVOKE with nothing to remove warns
    -- once per column when the runner is not the owner) — the shape of
    -- 20261017080742_EnforceAppendOnlyLedgerGrants.
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.daily_log_contents FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants. The EFFECTIVE
    -- privilege, not the ACL text: has_table_privilege follows role membership, which a REVOKE
    -- on agrisync_app alone cannot remove. A membership must never quietly hand the app role
    -- UPDATE or DELETE on a farmer's stored record — so this refuses instead of recording success.
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
            'ssf.daily_log_contents is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "capture_scope",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "daily_log_contents",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    content_version = table.Column<int>(type: "integer", nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    document = table.Column<string>(type: "jsonb", nullable: false),
                    origin = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    base_version = table.Column<int>(type: "integer", nullable: true),
                    written_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    written_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    client_request_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    app_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    words_erased_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_daily_log_contents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_daily_log_contents_daily_logs_daily_log_id",
                        column: x => x.daily_log_id,
                        principalSchema: "ssf",
                        principalTable: "daily_logs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_daily_log_contents_farms_farm_id",
                        column: x => x.farm_id,
                        principalSchema: "ssf",
                        principalTable: "farms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_daily_log_contents_farm_id",
                schema: "ssf",
                table: "daily_log_contents",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ux_daily_log_contents_log_version",
                schema: "ssf",
                table: "daily_log_contents",
                columns: new[] { "daily_log_id", "content_version" },
                unique: true);

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): the table and every stored detail go.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_daily_log_contents ON ssf.daily_log_contents;
DROP POLICY IF EXISTS p_tenant_daily_log_contents ON ssf.daily_log_contents;
");

            migrationBuilder.DropTable(
                name: "daily_log_contents",
                schema: "ssf");

            // Also data-destroying: which records were saved at the हजेरी door is forgotten.
            migrationBuilder.DropColumn(
                name: "capture_scope",
                schema: "ssf",
                table: "daily_logs");
        }
    }
}
