// spec: data-principle-spine-2026-05-05/04.8
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 04 sub-phase 04.8 — ships the
    /// Row-Level Security policies for <c>ssf.finance_corrections</c> and
    /// <c>ssf.correction_events</c> that were deferred from Phase 03
    /// (<c>20260516130000_EnableRowLevelSecurity</c> §75-84, OQ-9).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Carry-over from Phase 03 OQ-9.</b> The Phase 03 RLS migration
    /// explicitly deferred these two tables because neither carries
    /// <c>farm_id</c> directly and the FK chain to a farm-scoped parent had
    /// not been settled at that point. The conflict-resolver R2 verdict
    /// (decisions-log 2026-05-16 R2/03.3) routed the resolution to the
    /// Phase 04 audit-integrity ladder; the R3 verdict OQ-4 (decisions-log
    /// 2026-05-16 R3) then verified that <c>ssf.finance_corrections</c>
    /// DOES exist (the senior-architect's earlier grep had missed it —
    /// see <c>FinanceCorrectionConfiguration</c> and the
    /// <c>CorrectCostEntryHandler</c> persistence path) and committed to
    /// the EXISTS-via-<c>cost_entries</c> recipe verbatim below.
    /// </para>
    /// <para>
    /// <b>Pattern selection.</b>
    /// <list type="bullet">
    /// <item><c>finance_corrections</c> — no <c>farm_id</c> column on the
    /// table (verified per R3 OQ-4 against
    /// <c>FinanceCorrectionConfiguration</c>); the source of truth for
    /// tenant scope is <c>ssf.cost_entries.farm_id</c> reached via
    /// <c>cost_entry_id</c>. Policy uses the same EXISTS-join shape that
    /// Phase 03 §150-161 applied to
    /// <c>verification_events</c>→<c>daily_logs</c>, including the
    /// case-sensitive quoted <c>"Id"</c> on the parent (the
    /// <c>cost_entries</c> PK was declared as quoted <c>"Id"</c> in
    /// <c>20260218070000_InitialShramSafalSchema</c> §18-19 via raw SQL,
    /// so an unquoted <c>id</c> would fail with <c>column not found</c>).
    /// Unlike Phase 03's EXISTS-join policies which used
    /// <c>WITH CHECK (true)</c>, this policy uses the same EXISTS
    /// predicate in <c>WITH CHECK</c> per R3 OQ-4's verbatim recipe —
    /// the conflict-resolver wanted INSERT/UPDATE to be re-litigated at
    /// this layer so a forged <c>cost_entry_id</c> cannot smuggle a
    /// correction into another tenant's chain.</item>
    /// <item><c>correction_events</c> — also has no <c>farm_id</c>
    /// (verified against <c>20260504010000_AddCorrectionEvent</c>: the
    /// table is keyed on <c>user_id</c> for AI parse-correction
    /// telemetry). Policy compares <c>user_id</c> to the
    /// <c>agrisync.user_id</c> GUC that ships in Phase 03's
    /// <c>20260516130000_EnableRowLevelSecurity</c> chain (the GUC is
    /// injected per-transaction by the same
    /// <c>TenantConnectionInterceptor</c> that supplies
    /// <c>agrisync.farm_id</c>). No EXISTS-join is needed because
    /// correction telemetry is per-user not per-farm.</item>
    /// </list>
    /// </para>
    /// <para>
    /// <b><c>current_setting('agrisync.xxx', true)</c> — the
    /// <c>missing_ok=true</c> second argument.</b> Matches every other
    /// policy in this codebase. If the GUC is unset (e.g. a migration
    /// runner without a tenant claim, or a misconfigured connection), the
    /// call returns <c>NULL</c>; the comparison then yields <c>NULL</c>;
    /// the policy filters the row out. Fail-closed by construction —
    /// without the <c>true</c> flag, the call would raise <c>SQLSTATE
    /// 42704</c> and break the connection, which is louder but strictly
    /// worse for production resilience.
    /// </para>
    /// <para>
    /// <b>Idempotency.</b> <c>DROP POLICY IF EXISTS</c> before each
    /// <c>CREATE POLICY</c> so re-running the migration (e.g. after a
    /// rollback-and-replay in a staging environment) is safe — same
    /// discipline as the Phase 03 RLS migration.
    /// </para>
    /// <para>
    /// <b>ModelSnapshot diff is empty.</b> RLS policies are not
    /// model-level constructs; EF Core's metadata does not represent them.
    /// The accompanying Designer.cs therefore carries the identical
    /// model snapshot as <c>20260517000000_HardenAuditIntegrity</c>.
    /// </para>
    /// <para>
    /// <b>Down() is reversible.</b> Drops both policies and DISABLEs RLS
    /// on both tables in inverse order. Same shape as Phase 03's reverse
    /// pattern; local-dev iteration parity. Production rollback remains
    /// snapshot-restore per the Phase 04 plan §Rollback section.
    /// </para>
    /// </remarks>
    public partial class AddDeferredAuditRls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. finance_corrections — tenant scope via EXISTS-join to
            //   ssf.cost_entries. Pattern mirrors Phase 03's
            //   verification_events → daily_logs ("Id") policy. WITH CHECK
            //   re-litigates the EXISTS predicate per R3 OQ-4 (verbatim).
            migrationBuilder.Sql(@"
ALTER TABLE ssf.finance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.finance_corrections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_finance_corrections ON ssf.finance_corrections;
CREATE POLICY p_tenant_finance_corrections ON ssf.finance_corrections
  USING (EXISTS (
    SELECT 1 FROM ssf.cost_entries ce
    WHERE ce.""Id"" = finance_corrections.cost_entry_id
      AND ce.farm_id = current_setting('agrisync.farm_id', true)::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.cost_entries ce
    WHERE ce.""Id"" = finance_corrections.cost_entry_id
      AND ce.farm_id = current_setting('agrisync.farm_id', true)::uuid));
");

            // ── 2. correction_events — user-scoped (no farm_id; this is AI
            //   parse-correction telemetry keyed on user_id per
            //   20260504010000_AddCorrectionEvent). Policy reads the
            //   agrisync.user_id GUC injected by TenantConnectionInterceptor
            //   alongside agrisync.farm_id.
            migrationBuilder.Sql(@"
ALTER TABLE ssf.correction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.correction_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_user_correction_events ON ssf.correction_events;
CREATE POLICY p_user_correction_events ON ssf.correction_events
  USING (user_id = current_setting('agrisync.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('agrisync.user_id', true)::uuid);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ── Reverse 2. correction_events ─────────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_correction_events ON ssf.correction_events;
ALTER TABLE ssf.correction_events DISABLE ROW LEVEL SECURITY;
");

            // ── Reverse 1. finance_corrections ───────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_finance_corrections ON ssf.finance_corrections;
ALTER TABLE ssf.finance_corrections DISABLE ROW LEVEL SECURITY;
");
        }
    }
}
