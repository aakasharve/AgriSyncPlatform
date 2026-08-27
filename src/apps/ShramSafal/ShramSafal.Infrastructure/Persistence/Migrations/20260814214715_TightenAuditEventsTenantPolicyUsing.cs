// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.2
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// §P0.2 — audit authorization isolation, database half.
    ///
    /// <para>
    /// <b>The hole.</b> <c>p_tenant_audit_events</c> (created by
    /// <c>20260517000000_HardenAuditIntegrity</c>, NULLIF-hardened by
    /// <c>20260609144905_NullifHardenTenantGucRlsPolicies</c>) read
    /// <c>USING (farm_id IS NULL OR farm_id = &lt;farm_id GUC&gt;)</c>. The first
    /// disjunct made every NULL-farm row visible to <b>every</b> tenant, by
    /// design, and NULL-farm rows are exactly the cross-farm ones: retained
    /// voice-clip retention decisions (whose payload carries S3 object keys for
    /// other farmers' raw recordings), PII-review decisions and their unbounded
    /// staff note, admin elevation reasons, DEK handles, erasure/export subjects'
    /// GUIDs. 12,049 of 12,060 rows on the dev cluster are NULL-farm.
    /// </para>
    ///
    /// <para>
    /// <b>The rule.</b> A NULL-farm row belongs to the actor who caused it.
    /// <c>actor_user_id</c> is <c>NOT NULL</c>, indexed, guarded at every write
    /// site, and zero rows are NULL — a viable key. Essentially every NULL-farm
    /// row carries a <c>SystemActor</c> sentinel, so an actor rule correctly
    /// hides almost the whole set from every human caller. That is the intended
    /// outcome, not a side effect.
    /// </para>
    ///
    /// <para>
    /// 🛑 <b><c>WITH CHECK</c> IS DELIBERATELY UNTOUCHED.</b> <c>FORCE</c> applies
    /// policies to the table owner — and <c>ssf.audit_events</c> is owned by
    /// <c>agrisync_app</c> — while the admin cross-tenant context sets no tenant
    /// GUCs at all. Admin and worker audit WRITES therefore succeed only because
    /// <c>WITH CHECK</c> still carries <c>farm_id IS NULL</c>. Tightening it
    /// symmetrically would raise <c>42501</c> on the audit-first row
    /// <c>ShramSafalAdminDbContextFactory</c> writes <i>before</i> it hands back
    /// the privileged context — i.e. every admin elevation would start failing.
    /// The write-side hole is real and is recorded as a named follow-up, to be
    /// closed by giving the admin write path its own identity. It is not closed
    /// here, and a future editor must not "finish the job" by mirroring the
    /// predicate below into <c>WITH CHECK</c>.
    /// </para>
    ///
    /// <para>
    /// <b>Shape.</b> Only the <c>USING</c> expression changes:
    /// <c>ALTER POLICY … USING (…)</c> leaves <c>WITH CHECK</c> exactly as it
    /// stands. The GUC casts keep the house
    /// <c>NULLIF(current_setting(…), '')</c> wrap that <c>20260609144905</c>
    /// applied to every <c>ssf</c> policy, so an empty-string GUC coerces to NULL
    /// (matching nothing) instead of raising <c>22P02</c>. Both disjuncts fail
    /// closed when their GUC is unset.
    /// </para>
    ///
    /// <para>
    /// <b>Down()</b> restores the previous permissive <c>USING</c> verbatim, in
    /// its NULLIF-hardened form, for local-dev parity.
    /// </para>
    /// </summary>
    public partial class TightenAuditEventsTenantPolicyUsing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- §P0.2. USING ONLY. Do NOT mirror this into WITH CHECK — see the class
-- docstring: the admin context sets no GUCs and its audit-first write
-- survives only on the farm_id IS NULL branch of WITH CHECK.
ALTER POLICY p_tenant_audit_events ON ssf.audit_events
  USING (
    farm_id = (NULLIF(current_setting('agrisync.farm_id'::text, true), ''::text))::uuid
    OR (
      farm_id IS NULL
      AND actor_user_id = (NULLIF(current_setting('agrisync.user_id'::text, true), ''::text))::uuid
    )
  );
");

            // Fail loudly on the clone dry-run if the ALTER did not take. A
            // silently-unchanged policy is the one failure mode that would let
            // this migration report success while the leak stayed wide open.
            migrationBuilder.Sql(@"
DO $$
DECLARE v_qual text;
BEGIN
    SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_qual
    FROM pg_policy pol
    JOIN pg_class c     ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ssf' AND c.relname = 'audit_events'
      AND pol.polname = 'p_tenant_audit_events';

    IF v_qual IS NULL THEN
        RAISE EXCEPTION 'p_tenant_audit_events is missing on ssf.audit_events';
    END IF;

    IF v_qual NOT LIKE '%actor_user_id%' THEN
        RAISE EXCEPTION
            'p_tenant_audit_events USING was not tightened (still: %)', v_qual;
    END IF;
END $$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_audit_events ON ssf.audit_events
  USING (
    farm_id IS NULL
    OR farm_id = (NULLIF(current_setting('agrisync.farm_id'::text, true), ''::text))::uuid
  );
");
        }
    }
}
