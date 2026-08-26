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
    /// <b>Which privileged path keeps it.</b> A superuser bypasses every
    /// privilege check, so it needs no grant and none is invented here. No new
    /// role is created.
    /// </para>
    ///
    /// <para>
    /// 🛑 <b>CORRECTED 2026-08-20 — this migration does NOT run as a superuser on
    /// the path production uses, and an earlier version of this docstring said it
    /// did.</b> It claimed the runner is
    /// <c>ConnectionStrings:ShramSafalDb_Migration</c> (<c>postgres</c>,
    /// <c>rolsuper = t</c>). That is true only for the <c>dotnet ef</c> CLI, which
    /// resolves its connection through <c>ShramSafalDbContextFactory</c> — an
    /// <c>IDesignTimeDbContextFactory</c>. Production applies ShramSafal
    /// migrations by flipping <c>ALLOW_PRODUCTION_STARTUP_MIGRATIONS</c> and
    /// restarting the API, which migrates through the DI-registered context
    /// (<c>Program.cs:941</c>); that context is built at
    /// <c>DependencyInjection.cs:34</c> from <c>ConnectionStrings:ShramSafalDb</c>
    /// — <b>the ordinary application role</b>.
    /// </para>
    ///
    /// <para>
    /// <b>Why the original guard could never pass there.</b> It aborted unless
    /// <c>current_user</c> was a superuser <i>or still held TRUNCATE</i>. On the
    /// production path <c>current_user</c> IS <c>agrisync_app</c> — the role the
    /// statement immediately above has just revoked TRUNCATE from. Both limbs are
    /// false by construction, so the migration aborted deterministically,
    /// stopping the deploy at 11 of 16 and leaving the database half-migrated; in
    /// Production <c>Program.cs:1104</c> then rethrows and the API process exits.
    /// Reproduced as <c>agrisync_app</c> and as an RDS-master-shaped NOSUPERUSER
    /// role.
    /// </para>
    ///
    /// <para>
    /// <b>And waiting for a superuser runner would not have fixed it.</b> On
    /// Amazon RDS the master user holds <c>rds_superuser</c> membership but
    /// <c>rolsuper = f</c>, so pointing this at <c>ShramSafalDb_Migration</c>
    /// would still fail the original guard. (Stated from RDS's documented role
    /// model — <b>not</b> measured against the production instance, which is
    /// hibernated.) The guard therefore must not depend on the runner being a
    /// superuser at all.
    /// </para>
    ///
    /// <para>
    /// <b>What the guard checks now.</b> The safety property — <c>agrisync_app</c>
    /// can no longer TRUNCATE the ledger — is unchanged and still aborts if the
    /// revoke fails to take. What was removed is the second abort, whose premise
    /// was false: <i>the runner is not privileged</i> does not imply <i>nobody can
    /// perform lawful maintenance</i>. The guard now resolves which maintenance
    /// path actually survives, names it in the migration output, and aborts only
    /// if genuinely none does.
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
    v_owner         name;
    v_super_exists  boolean;
BEGIN
    SELECT has_table_privilege('agrisync_app', 'ssf.audit_events', 'TRUNCATE')
      INTO v_app_truncate;

    IF v_app_truncate THEN
        RAISE EXCEPTION
            'REVOKE TRUNCATE on ssf.audit_events did not take — agrisync_app can still erase the ledger';
    END IF;

    -- The other half of the ruling: the capability is MOVED, not deleted.
    --
    -- This deliberately does NOT abort when the runner is a non-superuser. That
    -- was the original guard, and it could never pass on the path production
    -- actually uses: startup migrations run as agrisync_app, the very role the
    -- REVOKE above has just stripped, so both limbs were false by construction
    -- and the deploy died at 11 of 16 with the database half-migrated. The
    -- premise was the bug -- 'this runner is unprivileged' does not mean 'no
    -- lawful maintenance path exists'.
    --
    -- Resolve which path genuinely survives, and say so out loud. Abort only if
    -- none does, which is the condition the original guard meant to catch.
    SELECT rolsuper INTO v_runner_super FROM pg_roles WHERE rolname = current_user;

    SELECT pg_get_userbyid(relowner) INTO v_owner
      FROM pg_class WHERE oid = 'ssf.audit_events'::regclass;

    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolsuper) INTO v_super_exists;

    IF COALESCE(v_runner_super, false) THEN
        RAISE NOTICE
            'TRUNCATE on ssf.audit_events: maintenance path = migration runner ''%'' is a superuser.',
            current_user;
    ELSIF v_owner IS NOT NULL THEN
        -- The honest name for this path. It is the same ownership property the
        -- 'Known limit' paragraph records: the owner can re-grant to itself. It
        -- is a real maintenance route and it is NOT a containment boundary, so
        -- report it as what it is rather than dress it up as a privileged role.
        RAISE WARNING
            'TRUNCATE on ssf.audit_events: runner ''%'' is NOT a superuser. Lawful maintenance remains possible only because table owner ''%'' can re-grant. Containment against the application role holds (that is the revoke above); containment against the OWNER does not, and never did.',
            current_user, v_owner;
    ELSIF v_super_exists THEN
        RAISE WARNING
            'TRUNCATE on ssf.audit_events: runner ''%'' is NOT a superuser and the table has no resolvable owner; a superuser exists on this cluster and is the only remaining maintenance path.',
            current_user;
    ELSE
        RAISE EXCEPTION
            'no privileged maintenance path retains TRUNCATE on ssf.audit_events (runner ''%'' is not a superuser, table has no resolvable owner, and no superuser exists on this cluster)',
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
