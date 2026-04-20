using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <inheritdoc />
    /// <remarks>
    /// Creates the append-only <c>analytics.events</c> event rail.
    ///
    /// Hand-edited from the EF-generated scaffold to honour three non-negotiable
    /// invariants from
    /// <c>_COFOUNDER/01_Operations/Plans/SHRAMSAFAL_MIS_INTEGRATION_PLAN_2026-04-18.md §4.2</c>:
    ///
    /// 1. <b>Partitioned by month</b> on <c>occurred_at_utc</c> so rollup scans stay
    ///    local to the current/prior partition at projected 7.5M-events/month volume.
    /// 2. <b>Append-only at the DB layer</b> — <c>ON UPDATE / ON DELETE DO INSTEAD
    ///    NOTHING</c> rules enforce the invariant even if an application bug tries
    ///    to mutate an event.
    /// 3. <b>Composite primary key</b> <c>(event_id, occurred_at_utc)</c> — Postgres
    ///    requires the partition key to be part of every unique constraint on a
    ///    partitioned table. The EF model still treats <c>EventId</c> as the logical
    ///    key; inserts always carry both columns so the composite constraint holds.
    ///
    /// Initial partitions: current month + next month. Future partitions are
    /// provisioned by a separate hosted job (out-of-scope for Phase 1).
    /// </remarks>
    public partial class AnalyticsInitial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(name: "analytics");

            migrationBuilder.Sql(@"
CREATE TABLE analytics.events (
    event_id                uuid         NOT NULL,
    event_type              varchar(80)  NOT NULL,
    occurred_at_utc         timestamptz  NOT NULL,
    actor_user_id           uuid         NULL,
    farm_id                 uuid         NULL,
    owner_account_id        uuid         NULL,
    actor_role              varchar(16)  NOT NULL,
    trigger                 varchar(24)  NOT NULL,
    device_occurred_at_utc  timestamptz  NULL,
    schema_version          varchar(8)   NOT NULL DEFAULT 'v1',
    props                   jsonb        NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT ""PK_events"" PRIMARY KEY (event_id, occurred_at_utc)
) PARTITION BY RANGE (occurred_at_utc);
");

            migrationBuilder.Sql(@"
CREATE INDEX ix_analytics_events_type_time
    ON analytics.events (event_type, occurred_at_utc DESC);

CREATE INDEX ix_analytics_events_farm_time
    ON analytics.events (farm_id, occurred_at_utc DESC)
    WHERE farm_id IS NOT NULL;

CREATE INDEX ix_analytics_events_account_time
    ON analytics.events (owner_account_id, occurred_at_utc DESC)
    WHERE owner_account_id IS NOT NULL;

CREATE INDEX ix_analytics_events_actor_time
    ON analytics.events (actor_user_id, occurred_at_utc DESC)
    WHERE actor_user_id IS NOT NULL;
");

            migrationBuilder.Sql(@"
CREATE RULE analytics_events_no_update AS
    ON UPDATE TO analytics.events DO INSTEAD NOTHING;

CREATE RULE analytics_events_no_delete AS
    ON DELETE TO analytics.events DO INSTEAD NOTHING;
");

            migrationBuilder.Sql(@"
DO $$
DECLARE
    cur_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
    cur_end   date := (cur_start + INTERVAL '1 month')::date;
    nxt_end   date := (cur_start + INTERVAL '2 months')::date;
    cur_name  text := to_char(cur_start, '""events_p_""YYYY_MM');
    nxt_name  text := to_char(cur_end,   '""events_p_""YYYY_MM');
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.events FOR VALUES FROM (%L) TO (%L);',
        cur_name, cur_start, cur_end);
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.events FOR VALUES FROM (%L) TO (%L);',
        nxt_name, cur_end,  nxt_end);
END
$$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP RULE IF EXISTS analytics_events_no_update ON analytics.events;");
            migrationBuilder.Sql("DROP RULE IF EXISTS analytics_events_no_delete ON analytics.events;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS analytics.events CASCADE;");
        }
    }
}
