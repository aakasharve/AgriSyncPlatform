// spec: 2026-07-13-labour-attendance-approval-design
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Phase 1 tenant-scope fix (2026-07-19 labour deploy hardening,
    /// founder decision 1c) — extends the user-scoped PERMISSIVE
    /// <c>FOR SELECT</c> pattern from
    /// <c>20260606074635_AddUserScopedFarmReadPolicies</c> and
    /// <c>20260607120000_AddUserScopedDataReadPolicies</c> to three more
    /// direct farm_id-keyed tables: <c>job_cards</c>, <c>compliance_signals</c>,
    /// <c>test_instances</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why.</b> Several <c>/sync/push</c> mutations (jobcard.assign/start/
    /// complete/settle/cancel, compliance.acknowledge/resolve,
    /// testinstance.collected/reported) read one of these three tables by ID
    /// to DISCOVER the owning farm before any <c>agrisync.farm_id</c> GUC can
    /// be set (the wire payload carries only the child entity's own id, never
    /// the farmId — the same shape as the <c>verify_log</c> trap this session
    /// fixes for <c>daily_logs</c> / <c>cost_entries</c>, which already had
    /// user-scoped policies). All three tables are already FORCE-RLS
    /// (<c>20260516130000_EnableRowLevelSecurity</c>,
    /// <c>DirectFarmScopedTables</c>) with ONLY the bare farm_id-keyed
    /// <c>p_tenant_{t}</c> policy — so under <c>/sync/push</c>'s admin-elevated,
    /// no-GUC-set posture, these reads matched ZERO rows even for a genuine
    /// farm member. This migration adds the missing SELECT-only sibling,
    /// keyed on <c>agrisync.user_id</c>, so
    /// <c>PushSyncBatchHandler.EstablishFarmScopeForOwnedEntityAsync</c> can
    /// read the row under phase (a) (user_id set, farm_id neutralised) before
    /// the farm is known.
    /// </para>
    /// <para>
    /// <b>SELECT-only + additive.</b> Same as the 06-07 sibling: PERMISSIVE
    /// policies OR-combine per command, so a SELECT now returns rows matching
    /// EITHER the single-tenant <c>p_tenant_{t}</c> (farm_id claim) OR this
    /// user-scoped policy. INSERT/UPDATE/DELETE are untouched — the write
    /// path (job card state transitions, signal acknowledge/resolve, test
    /// collect/report) stays locked to the <c>farm_id</c> claim via the
    /// existing <c>p_tenant_{t}</c> <c>FOR ALL</c> policy.
    /// </para>
    /// <para>
    /// <b>All three carry <c>farm_id</c> directly</b> (verified against their
    /// own <c>CreateTable</c> migrations —
    /// <c>20260421075209_AddJobCardsTable</c>,
    /// <c>20260421045922_AddComplianceSignalsTable</c>,
    /// <c>20260421032528_AddTestStackTables</c> — all lower-case, unquoted
    /// <c>farm_id</c>), so the same EXISTS-join-to-<c>ssf.farms</c> shape used
    /// for <c>plots</c>/<c>crop_cycles</c>/<c>daily_logs</c>/<c>cost_entries</c>/
    /// <c>attachments</c> in the 06-07 migration applies verbatim — no
    /// per-table PK-column quoting quirk to worry about here (that FK-chain
    /// caveat only matters for tables that reference a CHILD row's own PK,
    /// which none of these three policies do).
    /// </para>
    /// <para>
    /// <b><c>NULLIF(..., '')::uuid</c> is REQUIRED</b> — identical rationale
    /// to the 06-06/06-07 migrations: the interceptor emits
    /// <c>SET LOCAL agrisync.user_id = ''</c> for requests with no user
    /// claim; a bare <c>::uuid</c> cast throws on the empty string. <c>NULLIF</c>
    /// coerces it to NULL → no match → fail-closed. <c>status NOT IN (5, 6)</c>
    /// excludes Revoked(5)/Exited(6), matching every sibling policy.
    /// </para>
    /// <para>
    /// <b>Down()</b> drops the three policies only; it does NOT disable RLS
    /// (all three tables already had FORCE-RLS before this migration —
    /// additive). Idempotent <c>DROP POLICY IF EXISTS</c>.
    /// </para>
    /// </remarks>
    public partial class AddUserScopedJobCardComplianceTestReadPolicies : Migration
    {
        // Direct farm_id-keyed tables this migration grants a user-scoped
        // SELECT policy to. All three are already FORCE-RLS via the base
        // 20260516130000_EnableRowLevelSecurity migration's
        // DirectFarmScopedTables list.
        private static readonly string[] DirectFarmScopedTables =
        {
            "job_cards",
            "compliance_signals",
            "test_instances",
        };

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var t in DirectFarmScopedTables)
            {
                migrationBuilder.Sql($@"
DROP POLICY IF EXISTS p_user_select_{t} ON ssf.{t};
CREATE POLICY p_user_select_{t} ON ssf.{t}
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = {t}.farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status NOT IN (5, 6)
        )
      )
  ));
");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var t in DirectFarmScopedTables)
            {
                migrationBuilder.Sql($@"DROP POLICY IF EXISTS p_user_select_{t} ON ssf.{t};");
            }
        }
    }
}
