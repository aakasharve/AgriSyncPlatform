// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D3; founder D-68 round 2)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2; doctrine P1, P3, P4): <c>ssf.log_practice_reasons</c>,
    /// the reason ("का केलं") kept on ONE item of ONE saved record of work. The reason is never new work and never an edit of the record: it is its own
    /// row beside it. A later reason for the same record + item is a NEW row whose <c>supersedes_id</c> names the one it replaces; both stay, and the
    /// latest row per (<c>daily_log_id</c>, <c>work_key</c>) is the one that is shown.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. One new table and nothing else: no column on an existing table, no
    /// existing policy, grant, constraint or row changes. The currently deployed binary never names the table, so it runs unchanged against the migrated
    /// schema (an old phone never sends <c>logreason.set</c>; a new phone's reason waits in its outbox until the server that knows the mutation is live).
    /// FORCE-RLS from birth, tenant-scoped on its own <c>farm_id</c> (F8, the <c>p_tenant_{table}</c> shape of
    /// <c>20260516130000_EnableRowLevelSecurity</c>).</para>
    ///
    /// <para><b>No user-select policy, on purpose.</b> Every path that reads a reason opens the FARM scope first: the compare read
    /// (<c>GET /farms/{farmId}/compare</c> through <c>RouteFarmScope</c>) and the push door (<c>logreason.set</c>, the farm's scope from its own payload).
    /// A reason is never part of the pull and the attention board never reads it, so no path reads it under a bare user scope; a policy nobody
    /// needs would only be a second way in. WHICH reader may see WHICH reason is the application's rule (the compare read lists only what the reader
    /// may see of the record).</para>
    ///
    /// <para><b>APPEND-ONLY BY PRIVILEGE (P3).</b> <c>agrisync_app</c> keeps SELECT + INSERT only, with the effective-privilege guard copied from
    /// <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>, which REFUSES the migration rather than record success if the app role can still UPDATE /
    /// DELETE / TRUNCATE. A reason is never edited and never removed. Erasing the author runs through the privileged admin context
    /// (<c>ErasureWorker.ScrubLogPracticeReasonWordsAsync</c>): his <c>words</c> go to NULL, the kind stays.</para>
    ///
    /// <para><b>No foreign keys, on purpose (E4).</b> A foreign key's check runs outside row-level security, so a key to a record or a farm would tell a
    /// caller another farm's id exists. The application checks the record and the farm under the farm's own scope (the same answer for another farm's
    /// record as for a made-up id).</para>
    ///
    /// <para><b>The row holds a person id</b> (<c>author_user_id</c>, opaque), a kind (one of three fixed words), a work key (never a person's word)
    /// and, when he said some, his <c>words</c> (varchar(1000)). Erasure: KEEP the row, ERASE the words, see <c>ErasureWorker.cs</c>.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops the table: every reason kept on a record is lost and
    /// <c>ownWork[].reason</c> reads null again. Nothing else changes (the record itself, its version, its confirmation are never touched by a reason).
    /// Rolling back past this migration after reasons exist is a founder decision.</para>
    /// </summary>
    public partial class AddLogPracticeReasons : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.log_practice_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.log_practice_reasons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_log_practice_reasons ON ssf.log_practice_reasons;
CREATE POLICY p_tenant_log_practice_reasons ON ssf.log_practice_reasons
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DO $$
DECLARE
    v_rel      regclass := 'ssf.log_practice_reasons'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; log-practice-reason grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.log_practice_reasons TO agrisync_app;
    -- A reason is never edited and never removed: a later reason is a new row, and the latest one is current (doctrine P3).
    -- TRUNCATE is not a row operation, so RLS never sees it; revoked with UPDATE and DELETE. Revoked only where the app
    -- role holds something (the shape of 20261017080742_EnforceAppendOnlyLedgerGrants).
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.log_practice_reasons FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    -- A membership must never quietly hand the app role UPDATE or DELETE on a farmer's reasons.
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
            'ssf.log_practice_reasons is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "log_practice_reasons",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    work_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    words = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    said_by_voice = table.Column<bool>(type: "boolean", nullable: false),
                    author_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    supersedes_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_log_practice_reasons", x => x.Id);
                    table.CheckConstraint("ck_log_practice_reasons_kind", "kind IN ('Practice', 'Extra', 'Weather')");
                });

            migrationBuilder.CreateIndex(
                name: "ix_log_practice_reasons_farm",
                schema: "ssf",
                table: "log_practice_reasons",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_log_practice_reasons_log_item_created",
                schema: "ssf",
                table: "log_practice_reasons",
                columns: new[] { "daily_log_id", "work_key", "created_at_utc" });

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every reason kept on a record is lost.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_log_practice_reasons ON ssf.log_practice_reasons;
");

            migrationBuilder.DropTable(
                name: "log_practice_reasons",
                schema: "ssf");
        }
    }
}
