// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN — "Carried out of P0.2", TRUNCATE ruling 2026-08-15
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Closes the <c>TRUNCATE</c> hole in the append-only audit ledger.
    ///
    /// <para>
    /// <b>The hole.</b> <c>20260517000000_HardenAuditIntegrity</c> §169 revoked
    /// <c>UPDATE</c> and <c>DELETE</c> on <c>ssf.audit_events</c> from
    /// <c>agrisync_app</c> to make the ledger append-only. It never revoked
    /// <c>TRUNCATE</c>. Measured on <c>agrisync_dev_v2</c> before this migration,
    /// <c>agrisync_app</c>'s ACL on the table read
    /// <c>agrisync_app=arDxt/agrisync_app</c> — <c>a</c>=INSERT, <c>r</c>=SELECT,
    /// <c>D</c>=<b>TRUNCATE</b>, <c>x</c>=REFERENCES, <c>t</c>=TRIGGER. One
    /// statement from the ordinary application role erased the entire ledger, and
    /// <c>TRUNCATE</c> is not a row operation so row level security never sees it:
    /// the tenant policy is bypassed completely. Revoking <c>UPDATE</c>/<c>DELETE</c>
    /// while leaving <c>TRUNCATE</c> is an append-only guarantee with a hole the
    /// size of the table.
    /// </para>
    ///
    /// <para>
    /// <b>The ruling (founder, 2026-08-15).</b> <i>Revoke <c>TRUNCATE</c> from the
    /// normal application role while preserving deliberate privileged maintenance
    /// access.</i> The capability is not deleted — it is moved behind a role a
    /// farmer request can never reach.
    /// </para>
    ///
    /// <para>
    /// <b>Which privileged path keeps it, measured not assumed.</b> The
    /// surviving path is the <b>superuser migration role</b> — the role this very
    /// migration runs as (<c>ConnectionStrings:ShramSafalDb_Migration</c>, locally
    /// <c>postgres</c>, <c>rolsuper = t</c>). A superuser bypasses every privilege
    /// check, so it needs no grant and none is invented here. No new role is
    /// created. The guard below asserts that path is still open, so a future
    /// cluster that runs migrations as a NON-superuser fails loudly at deploy time
    /// instead of silently leaving nobody able to perform a lawful ledger
    /// maintenance operation.
    /// </para>
    ///
    /// <para>
    /// 🛑 <b><c>agrisync_owner</c> is NOT that path — the older docstring is wrong.</b>
    /// <c>20260517000000_HardenAuditIntegrity</c> claims "the owner role
    /// (<c>agrisync_owner</c>) retains <c>UPDATE</c>/<c>DELETE</c>". Measured, it
    /// does not: <c>ssf.audit_events</c> is owned by <c>agrisync_app</c> (only the
    /// <b>schema</b> was reassigned to <c>agrisync_owner</c> by
    /// <c>20260515090000_BootstrapDbRoles</c>), and <c>agrisync_owner</c> appears
    /// nowhere in the table ACL — <c>has_table_privilege</c> returns false for it
    /// on all of TRUNCATE/UPDATE/DELETE/INSERT/SELECT. It is <c>NOLOGIN</c> and not
    /// a superuser. Recorded here so the next reader does not rely on it.
    /// </para>
    ///
    /// <para>
    /// <b>Known limit, deliberately not closed here.</b> Because
    /// <c>agrisync_app</c> <i>owns</i> <c>ssf.audit_events</c>, it can re-grant the
    /// privilege to itself. That is a pre-existing property of the whole
    /// audit-family lockdown — it applies identically to the <c>UPDATE</c>/
    /// <c>DELETE</c> revoke that has stood since 2026-05-17 — and closing it means
    /// moving table ownership, which is a permissions-model change, not this
    /// containment fix. Recorded, not widened.
    /// </para>
    ///
    /// <para>
    /// <b>Scope.</b> <c>ssf.audit_events</c> only. <c>ssf.correction_events</c> and
    /// <c>ssf.ai_job_attempts</c> carry the same <c>D</c> bit and are deliberately
    /// left alone: the ruling names the audit ledger and explicitly forbids
    /// widening this into a permissions review. Recorded as a follow-up.
    /// </para>
    ///
    /// <para>
    /// <b>Down()</b> grants <c>TRUNCATE</c> back to <c>agrisync_app</c>, mirroring
    /// <c>HardenAuditIntegrity.Down()</c>'s treatment of <c>UPDATE</c>/<c>DELETE</c>.
    /// </para>
    /// </summary>
    public partial class RevokeTruncateOnAuditEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- The append-only ledger, finished. TRUNCATE bypasses row level security
-- entirely, so leaving it on the application role made every RLS proof on
-- ssf.audit_events conditional on nobody issuing one statement.
REVOKE TRUNCATE ON ssf.audit_events FROM agrisync_app;
");

            // Fail loudly rather than report success on a revoke that did not
            // take — the same failure mode 20260814214715 guards against on its
            // ALTER POLICY. A silent no-op here would leave the ledger erasable
            // while the migration history claims it is not.
            migrationBuilder.Sql(@"
DO $$
DECLARE
    v_app_truncate  boolean;
    v_runner_super  boolean;
BEGIN
    SELECT has_table_privilege('agrisync_app', 'ssf.audit_events', 'TRUNCATE')
      INTO v_app_truncate;

    IF v_app_truncate THEN
        RAISE EXCEPTION
            'REVOKE TRUNCATE on ssf.audit_events did not take — agrisync_app can still erase the ledger';
    END IF;

    -- The other half of the ruling: the capability is MOVED, not deleted. The
    -- deliberate privileged path is the superuser migration role. If a cluster
    -- ever runs migrations as a non-superuser, stop here rather than quietly
    -- leaving no lawful maintenance path at all.
    SELECT rolsuper INTO v_runner_super FROM pg_roles WHERE rolname = current_user;

    IF NOT COALESCE(v_runner_super, false)
       AND NOT has_table_privilege(current_user, 'ssf.audit_events', 'TRUNCATE') THEN
        RAISE EXCEPTION
            'no privileged maintenance path retains TRUNCATE on ssf.audit_events (migration runner ''%'' is not a superuser and holds no grant)',
            current_user;
    END IF;
END $$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
GRANT TRUNCATE ON ssf.audit_events TO agrisync_app;
");
        }
    }
}
