using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Revert of Fix F2 (<c>20260703110812_HardenChildTableRlsWriteCheck</c>).
    /// That migration rewrote the seven derivation child-table tenant policies'
    /// WITH CHECK from <c>(true)</c> — the original
    /// <c>20260516130000</c>-era design — to an
    /// <c>EXISTS(... parent farm_operations/daily_logs.farm_id = GUC ...)</c>
    /// predicate. The predicate is correct for SEPARATE INSERT statements, but it
    /// FAILS when EF batches the parent + child in ONE SaveChanges: the confirm-
    /// time <c>LedgerDerivationService</c> stages the parent <c>FarmOperation</c>
    /// (or relies on the parent <c>DailyLog</c>) and its child rows together and
    /// flushes once, so a child WITH CHECK EXISTS against the not-yet-visible
    /// same-batch parent resolves false → 42501 (proven red on :5433 by
    /// <c>LedgerDerivationSupersessionRealPostgresTests</c>).
    /// </summary>
    /// <remarks>
    /// <para>F2 hardened Codex Finding-2 (child WITH CHECK ungated). That gap is
    /// NON-LIVE-EXPLOITABLE: the parent <c>farm_operations</c>/<c>daily_logs</c>
    /// tenant WITH CHECK (predating F2, untouched here) is the real INSERT gate,
    /// and the only writer of these children is the derivation side-car, which
    /// always creates/owns the parent in-tenant first. No user endpoint inserts
    /// these children with an arbitrary parent id. Finding-2 is therefore deferred
    /// as non-live pre-flag-flip hardening — see spec
    /// <c>ai-intelligence-plan-2026-06-25</c>.</para>
    /// <para>ALTER POLICY only — USING is untouched; no tables/columns/data change
    /// (additive-only, safe for a prod deploy). Down() re-applies the F2 EXISTS
    /// predicate so this revert is itself reversible.
    /// <c>ssf.weather_stamps</c> is deliberately NOT reverted: its parent
    /// <c>daily_logs</c> row is committed in the handler's Phase-1 SaveChanges
    /// BEFORE the Phase-2 side-car flush that inserts the weather stamp, so its
    /// WITH CHECK EXISTS resolves true (the parent is already visible) and it does
    /// not break the batched flow.</para>
    /// </remarks>
    public partial class RevertChildTableRlsWriteCheckToTrue : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Restore each child policy's WITH CHECK to the pre-F2 (true) state.
            // The parent farm_operations / daily_logs tenant WITH CHECK remains
            // the real INSERT gate. USING clauses are left untouched.
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_application_input_items ON ssf.application_input_items
  WITH CHECK (true);
");
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_event_links ON ssf.event_links
  WITH CHECK (true);
");
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_irrigation_entries ON ssf.irrigation_entries
  WITH CHECK (true);
");
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_labour_assignments ON ssf.labour_assignments
  WITH CHECK (true);
");
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_machinery_usages ON ssf.machinery_usages
  WITH CHECK (true);
");
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_observation_events ON ssf.observation_events
  WITH CHECK (true);
");
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_disturbance_events ON ssf.disturbance_events
  WITH CHECK (true);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Re-apply Fix F2's EXISTS tenant predicate (mirrors each policy's
            // USING clause) so this revert is reversible.

            // application_input_items — parent = farm_operations via operation_id
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_application_input_items ON ssf.application_input_items
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.farm_operations o
    WHERE o.""Id"" = application_input_items.operation_id
      AND o.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
");

            // event_links — parent = farm_operations via from_operation_id
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_event_links ON ssf.event_links
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.farm_operations o
    WHERE o.""Id"" = event_links.from_operation_id
      AND o.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
");

            // irrigation_entries — parent = daily_logs via daily_log_id
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_irrigation_entries ON ssf.irrigation_entries
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = irrigation_entries.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
");

            // labour_assignments — parent = daily_logs via daily_log_id
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_labour_assignments ON ssf.labour_assignments
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = labour_assignments.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
");

            // machinery_usages — parent = daily_logs via daily_log_id
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_machinery_usages ON ssf.machinery_usages
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = machinery_usages.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
");

            // observation_events — parent = daily_logs via daily_log_id
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_observation_events ON ssf.observation_events
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = observation_events.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
");

            // disturbance_events — parent = daily_logs via daily_log_id
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_disturbance_events ON ssf.disturbance_events
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = disturbance_events.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
");
        }
    }
}
