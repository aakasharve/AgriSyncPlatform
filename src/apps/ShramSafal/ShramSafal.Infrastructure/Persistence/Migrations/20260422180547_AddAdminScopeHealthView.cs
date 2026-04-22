using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminScopeHealthView : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // mis.admin_scope_health — hourly rollup of admin.scope.* analytics events.
            // Powers Metabase card 15 ("Admin scope health") and feeds the admin
            // dashboard resolver-observability view.
            //
            // Refreshed by MisRefreshJob (nightly) — reads analytics.events.props jsonb
            // for resolveMs percentiles. Safe to refresh CONCURRENTLY because of the
            // unique index on bucket_hour.
            migrationBuilder.Sql(@"
CREATE SCHEMA IF NOT EXISTS mis;

CREATE MATERIALIZED VIEW IF NOT EXISTS mis.admin_scope_health AS
SELECT
    date_trunc('hour', occurred_at_utc) AS bucket_hour,
    COUNT(*) FILTER (WHERE event_type = 'admin.scope.resolved')        AS resolved_count,
    COUNT(*) FILTER (WHERE event_type = 'admin.scope.ambiguous')       AS ambiguous_count,
    COUNT(*) FILTER (WHERE event_type = 'admin.scope.unauthorized')    AS unauthorized_count,
    COUNT(*) FILTER (WHERE event_type = 'admin.scope.forbidden')       AS forbidden_count,
    COUNT(*) FILTER (WHERE event_type = 'admin.active_org.switched')   AS switch_count,
    COUNT(*) FILTER (WHERE event_type = 'admin.scope.drift_detected')  AS drift_count,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY NULLIF(props->>'resolveMs','')::int)
        FILTER (WHERE event_type = 'admin.scope.resolved')             AS resolve_ms_p50,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY NULLIF(props->>'resolveMs','')::int)
        FILTER (WHERE event_type = 'admin.scope.resolved')             AS resolve_ms_p95,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY NULLIF(props->>'resolveMs','')::int)
        FILTER (WHERE event_type = 'admin.scope.resolved')             AS resolve_ms_p99
FROM analytics.events
WHERE event_type LIKE 'admin.%'
  AND occurred_at_utc >= NOW() - INTERVAL '7 days'
GROUP BY 1
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS ix_admin_scope_health_bucket
    ON mis.admin_scope_health (bucket_hour);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP MATERIALIZED VIEW IF EXISTS mis.admin_scope_health;
");
        }
    }
}
