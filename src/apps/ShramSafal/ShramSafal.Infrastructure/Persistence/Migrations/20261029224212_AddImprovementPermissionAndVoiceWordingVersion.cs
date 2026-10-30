using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36, D-31).
    /// ADDITIVE ONLY — one new table, one new nullable column, nothing dropped, renamed,
    /// tightened or defaulted on an existing row. Every old phone keeps working unchanged.
    ///
    /// <para><b><c>ssf.improvement_permission_events</c></b> — the OPTIONAL improvement
    /// permission ("माझ्या अनुभवातून श्रमसफल अधिक सक्षम होऊ द्या"), one append-only row per
    /// choice: who, yes/no, which words, which language, which app, when. No row = OFF, the
    /// default. Separate from the service tick, from "keep my original voice" and from the
    /// old consent toggles, which never count as this permission.</para>
    ///
    /// <para><b>Append-only by PRIVILEGE</b> (UPDATE / DELETE / TRUNCATE revoked from the app
    /// role), exactly as the two consent-gate ledgers (20260816170524_AddConsentGateLedgers):
    /// a withdrawal is a new row, never an edit. <b>RLS</b> ENABLE + FORCE with a SELF-only
    /// policy keyed on <c>agrisync.user_id</c> — a permission belongs to a person, not a
    /// farm. Unlike those ledgers there is no pre-login row, so the WITH CHECK admits only
    /// the caller's own id.</para>
    ///
    /// <para><b><c>ssf.user_consent_state.full_history_journal_wording_version</c></b> —
    /// nullable, no default: which words the "keep my original voice" choice was last made
    /// under (D-31 widened that switch to "I and authorized reviewers on this farm"). Every
    /// existing row reads NULL = unknown words, which is the truth.</para>
    ///
    /// <para><b>Down</b> drops the policy, the table and the column — it removes only what
    /// Up added. Rows written in between are lost on Down (consent evidence; take the
    /// pre-migration snapshot, doctrine E8).</para>
    /// </summary>
    public partial class AddImprovementPermissionAndVoiceWordingVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "full_history_journal_wording_version",
                schema: "ssf",
                table: "user_consent_state",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "improvement_permission_events",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    allowed = table.Column<bool>(type: "boolean", nullable: false),
                    wording_version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    language_shown = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    app_version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    chosen_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_improvement_permission_events", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_improvement_permission_events_user_chosen",
                schema: "ssf",
                table: "improvement_permission_events",
                columns: new[] { "user_id", "chosen_at_utc" });

            migrationBuilder.Sql(@"
ALTER TABLE ssf.improvement_permission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.improvement_permission_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_self_improvement_permission_events ON ssf.improvement_permission_events;
CREATE POLICY p_self_improvement_permission_events ON ssf.improvement_permission_events
  USING      (user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid);

DO $$
DECLARE
    v_rel      regclass := 'ssf.improvement_permission_events'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; improvement-permission grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.improvement_permission_events TO agrisync_app;
    -- TRUNCATE is not a row operation, so RLS never sees it; revoked with UPDATE and DELETE for
    -- the same reason as on the consent-gate ledgers. Revoked only where the app role holds
    -- something (a REVOKE with nothing to remove warns once per column when the runner is not
    -- the owner) — the same shape as 20261017080742_EnforceAppendOnlyLedgerGrants.
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.improvement_permission_events FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants. The EFFECTIVE
    -- privilege, not the ACL text: has_table_privilege follows role membership, which a REVOKE
    -- on agrisync_app alone cannot remove. A membership must never quietly hand the app role
    -- UPDATE or DELETE on a consent record — so this refuses instead of recording success.
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
            'ssf.improvement_permission_events is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_self_improvement_permission_events ON ssf.improvement_permission_events;
");

            migrationBuilder.DropTable(
                name: "improvement_permission_events",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "full_history_journal_wording_version",
                schema: "ssf",
                table: "user_consent_state");
        }
    }
}
