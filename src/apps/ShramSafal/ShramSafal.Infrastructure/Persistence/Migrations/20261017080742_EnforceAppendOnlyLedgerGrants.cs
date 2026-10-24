// spec: 2026-08-25-prod-cutover-waves
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Makes the append-only ledgers append-only at the PRIVILEGE level for the
    /// ordinary application role, measured as the EFFECTIVE privilege rather than
    /// as the text of a GRANT.
    ///
    /// <para>
    /// <b>The defect.</b> <c>20260831185516_AddAttendanceMarkCorrections</c> says the
    /// table is "APPEND-ONLY, ENFORCED BY THE GRANT" and grants
    /// <c>SELECT, INSERT</c> only. But <c>GRANT</c> is additive: it never removes
    /// what a role already holds. <c>20260515090000_BootstrapDbRoles</c> installed
    /// <c>ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
    /// TO agrisync_app</c>, so every <c>ssf</c> table created afterwards hands the app
    /// role <c>UPDATE</c> and <c>DELETE</c> at creation. Measured on a freshly migrated
    /// database: the app role's ACL on <c>ssf.attendance_mark_corrections</c> read
    /// <c>agrisync_app=arwd</c>, and an <c>UPDATE</c> and a <c>DELETE</c> issued as
    /// <c>agrisync_app</c> each changed one row. Where the application role itself
    /// runs the migrations it OWNS the new table, and the owner's default ACL also
    /// carries <c>TRUNCATE</c> — which row level security never sees.
    /// The ledgers that DO hold (audit_events, question_events, the consent
    /// ledgers) all issue an explicit <c>REVOKE</c>; this one only granted.
    /// </para>
    ///
    /// <para>
    /// <b>What this migration does.</b> <see cref="UpSql"/> revokes
    /// <c>UPDATE, DELETE, TRUNCATE</c> from <c>agrisync_app</c> on every <c>ssf</c>
    /// ledger the repository declares append-only BY PRIVILEGE (nine tables, listed
    /// on <see cref="UpSql"/>). For most of them <c>UPDATE</c>/<c>DELETE</c>
    /// were already revoked by their own migrations and re-revoking is a no-op; the
    /// changes are <c>UPDATE, DELETE, TRUNCATE</c> on
    /// <c>ssf.attendance_mark_corrections</c>, and <c>TRUNCATE</c> on
    /// <c>correction_events</c>, <c>ai_job_attempts</c>, <c>cross_border_transfers</c>
    /// and <c>consent_audit</c> — the follow-up <c>20260815052139_RevokeTruncateOnAuditEvents</c>
    /// recorded and deliberately left open. <c>SELECT</c> and <c>INSERT</c> are not
    /// touched: appending and reading are the ledgers' whole purpose.
    /// </para>
    ///
    /// <para>
    /// <b>Deliberately NOT in the set.</b> Tables described as append-only only by
    /// their CODE (no mutator, no route) are not changed here, because a privilege
    /// change on them is a behaviour change with callers to audit first. In
    /// particular <c>ssf.labour_corrections</c>: creator erasure
    /// (<c>ErasureWorker.AnonymizeLabourCorrectionsAsync</c>, founder ruling
    /// 2026-08-27) UPDATEs it and its design note relies on no REVOKE existing there.
    /// </para>
    ///
    /// <para>
    /// <b>Fails loudly rather than claim a property that does not hold.</b> After
    /// the revoke, <see cref="UpSql"/> asks <c>has_table_privilege</c> — the
    /// effective answer, inheritance included — for every ledger and privilege, and
    /// RAISES if the app role can still update, delete or truncate any of them,
    /// naming every role the privilege still flows through. Two ways that happens
    /// and a <c>REVOKE ... FROM agrisync_app</c> cannot fix either: the runner lacked
    /// authority over the grant, or the app role INHERITS the privilege through
    /// membership in another role (for example the role that owns the table). The
    /// second needs a role-model decision, not a migration, so the migration stops
    /// instead of recording success.
    /// </para>
    ///
    /// <para>
    /// <b>Known limit, reported not hidden.</b> If the app role OWNS a ledger (it
    /// does wherever it runs the migrations), the revoke removes the privilege from
    /// its statements but an owner can always re-grant to itself, and owner or
    /// schema-owner rights also cover <c>DROP TABLE</c>. The guard emits a
    /// <c>WARNING</c> naming each such table. Containment against the owner needs
    /// ownership moved to a role the app role is not a member of.
    /// </para>
    ///
    /// <para>
    /// <b>Safe on a live database.</b> No data change, no table rewrite, no DDL
    /// beyond <c>REVOKE</c>/<c>GRANT</c>, which take no lock on the tables
    /// themselves (measured: inside an open transaction a REVOKE held no relation
    /// lock on its table). Idempotent: re-running revokes nothing new and the guard
    /// re-asserts the same state. The previous binary never updates, deletes or
    /// truncates these tables, so it runs unchanged against the migrated schema.
    /// </para>
    ///
    /// <para>
    /// <b>Down()</b> (<see cref="DownSql"/>) restores the previous grants exactly
    /// where their source is knowable: <c>UPDATE, DELETE</c> on
    /// <c>ssf.attendance_mark_corrections</c> (what the default privileges gave), and
    /// <c>TRUNCATE</c> on the five tables whose <c>TRUNCATE</c> this migration
    /// removes ONLY where <c>agrisync_app</c> owns the table — the only way the app
    /// role ever held it. Nothing is restored on the ledgers whose revokes were
    /// already in place.
    /// </para>
    /// </summary>
    public partial class EnforceAppendOnlyLedgerGrants : Migration
    {
        /// <summary>
        /// The exact SQL <see cref="Up"/> runs; tests execute this same text. The
        /// ledger list is a literal on purpose: a shipped migration is history and
        /// must not change when some later list does. Each entry is a table whose
        /// own migration declares it append-only by privilege —
        /// attendance_mark_corrections (AddAttendanceMarkCorrections, the defect),
        /// audit_events / correction_events / ai_job_attempts (HardenAuditIntegrity),
        /// cross_border_transfers (PrivacyEdge), consent_audit (ConsentDomain),
        /// question_events (AddDfesDataSpine), terms_acceptance_events /
        /// consent_grant_events (AddConsentGateLedgers).
        /// </summary>
        internal const string UpSql = @"
DO $$
DECLARE
    v_ledgers   text[] := ARRAY[
        'ssf.attendance_mark_corrections', 'ssf.audit_events', 'ssf.correction_events',
        'ssf.ai_job_attempts', 'ssf.cross_border_transfers', 'ssf.consent_audit',
        'ssf.question_events', 'ssf.terms_acceptance_events', 'ssf.consent_grant_events'];
    v_privs     text[] := ARRAY['UPDATE', 'DELETE', 'TRUNCATE'];
    v_ledger    text;
    v_priv      text;
    v_rel       regclass;
    v_owner     name;
    v_holders   text;
    v_failures  text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; append-only ledger grants not applicable here.';
        RETURN;
    END IF;

    -- Revoke only where the app role holds something: a REVOKE that has nothing to
    -- remove still emits one 'no privileges could be revoked' WARNING per column
    -- when the runner is not the owner, which would bury the warnings below.
    FOREACH v_ledger IN ARRAY v_ledgers LOOP
        IF has_table_privilege('agrisync_app', v_ledger, 'UPDATE')
           OR has_table_privilege('agrisync_app', v_ledger, 'DELETE')
           OR has_table_privilege('agrisync_app', v_ledger, 'TRUNCATE') THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM agrisync_app', v_ledger);
        END IF;
    END LOOP;

    -- The guard. The EFFECTIVE privilege, not the ACL text: has_table_privilege
    -- follows role membership, which a REVOKE on agrisync_app alone cannot remove.
    FOREACH v_ledger IN ARRAY v_ledgers LOOP
        v_rel := v_ledger::regclass;
        SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;

        FOREACH v_priv IN ARRAY v_privs LOOP
            IF has_table_privilege('agrisync_app', v_rel, v_priv) THEN
                -- Name every ACL entry the app role can draw this privilege from:
                -- itself (the revoke did not take), a role it is a member of, or
                -- PUBLIC. An empty list means the app role is a superuser.
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

                v_failures := v_failures || format(E'\n  %s %s via %s', v_ledger, v_priv,
                    COALESCE(v_holders, 'superuser (agrisync_app bypasses privilege checks)'));
            END IF;
        END LOOP;

        -- MEMBER, not USAGE: a role that can merely SET ROLE to the owner can
        -- re-grant too, inherited privileges or not.
        IF pg_has_role('agrisync_app', v_owner, 'MEMBER') THEN
            RAISE WARNING
                '% is owned by % and agrisync_app can act as that owner: statements issued as agrisync_app are now refused UPDATE/DELETE/TRUNCATE, but the owner can re-grant them and can drop the table. Containment against the owner needs ownership moved to a role agrisync_app is not a member of.',
                v_ledger, v_owner;
        END IF;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'append-only ledgers are still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>The exact SQL <see cref="Down"/> runs. Tests execute this same text.</summary>
        internal const string DownSql = @"
DO $$
DECLARE
    v_ledger text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RETURN;
    END IF;

    -- What 20260515090000_BootstrapDbRoles' default privileges handed the app role
    -- when the table was created (and what ownership gave where the app role owns it).
    GRANT UPDATE, DELETE ON ssf.attendance_mark_corrections TO agrisync_app;

    -- TRUNCATE never came from any GRANT in the chain. The app role held it only as
    -- the table OWNER's default ACL, so it is restored only where that is its source.
    FOREACH v_ledger IN ARRAY ARRAY[
        'ssf.attendance_mark_corrections', 'ssf.correction_events', 'ssf.ai_job_attempts',
        'ssf.cross_border_transfers', 'ssf.consent_audit'] LOOP
        IF (SELECT relowner FROM pg_class WHERE oid = v_ledger::regclass) = 'agrisync_app'::regrole THEN
            EXECUTE format('GRANT TRUNCATE ON %s TO agrisync_app', v_ledger);
        END IF;
    END LOOP;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(UpSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(DownSql);
        }
    }
}
