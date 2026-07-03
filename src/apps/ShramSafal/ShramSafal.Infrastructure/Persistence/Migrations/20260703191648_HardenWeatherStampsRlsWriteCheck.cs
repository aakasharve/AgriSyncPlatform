using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Codex Finding 2 follow-up — the earlier
    /// <c>20260703110812_HardenChildTableRlsWriteCheck</c> migration tightened
    /// seven daily_logs / farm_operations child-table tenant policies from
    /// <c>WITH CHECK (true)</c> to the same EXISTS tenant predicate as their
    /// USING clause, but MISSED <c>ssf.weather_stamps</c>
    /// (<c>p_tenant_weather_stamps</c>, created in
    /// <c>20260630040851_AddWeatherStampsTable</c>, still shipped with
    /// <c>WITH CHECK (true)</c> — INSERT/UPDATE ungated).
    /// </summary>
    /// <remarks>
    /// This migration is <b>ALTER POLICY only</b>. It mirrors the policy's
    /// existing USING tenant predicate (EXISTS-join to <c>ssf.daily_logs</c>
    /// via <c>daily_log_id</c>, NULLIF-hardened per ADR 0020) into WITH CHECK
    /// so read and write use the identical tenant gate. USING is untouched; no
    /// tables/columns/data are changed (additive-only, safe for a prod
    /// deploy). See ADR 0023 §2. Down() reverts WITH CHECK back to (true).
    /// </remarks>
    public partial class HardenWeatherStampsRlsWriteCheck : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // weather_stamps — parent = daily_logs via daily_log_id.
            // Predicate copied verbatim from the policy's USING clause in
            // 20260630040851_AddWeatherStampsTable.
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_weather_stamps ON ssf.weather_stamps
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = weather_stamps.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Revert the WITH CHECK back to the prior (true) state.
            migrationBuilder.Sql(@"
ALTER POLICY p_tenant_weather_stamps ON ssf.weather_stamps
  WITH CHECK (true);
");
        }
    }
}
