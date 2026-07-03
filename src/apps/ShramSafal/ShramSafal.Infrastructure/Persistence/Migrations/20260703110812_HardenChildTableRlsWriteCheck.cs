using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class HardenChildTableRlsWriteCheck : Migration
    {
        // Codex Finding 2 (founder-approved hardening) — the seven daily_logs /
        // farm_operations child-table tenant policies shipped with an explicit
        // WITH CHECK (true), which overrides Postgres's default (WITH CHECK
        // defaults to the USING expr) and leaves INSERT/UPDATE ungated. This
        // migration is ALTER POLICY only — it mirrors each policy's existing
        // USING tenant predicate into WITH CHECK so read and write use the
        // identical tenant gate. USING is untouched; no tables/columns/data are
        // changed (additive-only, safe for a prod deploy). See ADR 0023 §2.

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Revert each policy's WITH CHECK back to the prior (true) state.
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
    }
}
