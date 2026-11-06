// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 4 ("day 0 and RLS")
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// lane L8b-1 — a plot's schedule choice is kept on the server, behind the farm wall.
    ///
    /// <para><b>Day 0.</b> Adds <c>ssf.schedule_subscriptions.reference_date date NULL</c>: the plot's day 0 the farmer
    /// set in "शेड्यूल बदला" (a pruning or planting day). NULL — every row made before this migration, and every adopt an
    /// older phone sends — means the crop season's own start. Additive, nullable, no default: the deployed binary never
    /// reads or writes it, so it runs unchanged against the migrated schema (E8).</para>
    ///
    /// <para><b>The farm wall.</b> <c>ssf.schedule_subscriptions</c> and <c>ssf.schedule_migration_events</c> are ONE
    /// farm's choices — each row carries a direct <c>farm_id</c> (F8: a direct tenant column, never an EXISTS through a
    /// parent) — yet sat on the RLS exemption inventory under the TEMPLATES' "author-owned" reason. Both now get the house
    /// tenant policy (<c>farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid</c>, USING and WITH CHECK)
    /// under ENABLE + FORCE (the app role owns its tables on every real cluster, and an owner bypasses ENABLE-only RLS).
    /// Every door that reads or writes them already opens the farm's scope first: the REST schedule routes
    /// (<c>RouteFarmScope.OpenAsync</c>), the sync push (<c>EstablishFarmScopeForDerivationAsync</c>) and the compliance
    /// read inside a log write. <c>schedule_subscriptions</c> also gets the user-scoped read every farm-data table has
    /// (<c>p_user_select_*</c>: the farm's registrant or an ACTIVE seat, <c>m.status = 3</c>), so the multi-farm pull lane
    /// L8b-2 adds needs no schema change; who of the farm may read which plot's choice stays the application's rule (E4).
    /// Migration events get no user read: nothing reads them outside a farm's scope.</para>
    ///
    /// <para><b>Behaviour (E8: classified by behaviour, not by operation).</b> FORCE RLS narrows: a read or write of these
    /// two tables WITHOUT a farm scope now sees nothing / is refused (42501). No such door exists in this binary (lane
    /// L8b-1's real-Postgres suite drives every one as agrisync_app). The deployed binary's schedule doors could never adopt
    /// (they looked the id up in a model nobody lists), so no farmer action of today's binary depends on these rows.</para>
    ///
    /// <para><b>Down()</b> drops the three policies, takes both tables back out of RLS, and drops <c>reference_date</c>:
    /// it DESTROYS every day 0 recorded since this migration (the subscriptions themselves are kept; their day 0 falls
    /// back to the crop season's start). Nothing else is touched.</para>
    /// </summary>
    public partial class AddScheduleSubscriptionDayZeroAndRls : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.schedule_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_schedule_subscriptions ON ssf.schedule_subscriptions;
CREATE POLICY p_tenant_schedule_subscriptions ON ssf.schedule_subscriptions
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_schedule_subscriptions ON ssf.schedule_subscriptions;
CREATE POLICY p_user_select_schedule_subscriptions ON ssf.schedule_subscriptions
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = schedule_subscriptions.farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

ALTER TABLE ssf.schedule_migration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_migration_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_schedule_migration_events ON ssf.schedule_migration_events;
CREATE POLICY p_tenant_schedule_migration_events ON ssf.schedule_migration_events
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
";

        /// <summary>
        /// Fails the migration loudly (clone dry-run, test boot) if either table is not ENABLEd AND FORCEd, or its tenant
        /// policy is missing or not keyed on farm_id: a table that is enabled but not forced reports success while leaving
        /// the app role — which owns it — unconstrained.
        /// </summary>
        internal const string VerifySql = @"
DO $$
DECLARE
    t text;
    v_enabled boolean;
    v_forced  boolean;
    v_qual    text;
BEGIN
    FOREACH t IN ARRAY ARRAY['schedule_subscriptions', 'schedule_migration_events'] LOOP
        SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_enabled, v_forced
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ssf' AND c.relname = t;

        IF NOT v_enabled THEN
            RAISE EXCEPTION 'ssf.% did not ENABLE ROW LEVEL SECURITY', t;
        END IF;

        IF NOT v_forced THEN
            RAISE EXCEPTION 'ssf.% did not FORCE ROW LEVEL SECURITY: the table owner (agrisync_app) would bypass the policy', t;
        END IF;

        SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_qual
          FROM pg_policy pol
          JOIN pg_class c     ON c.oid = pol.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ssf' AND c.relname = t AND pol.polname = 'p_tenant_' || t;

        IF v_qual IS NULL OR v_qual NOT LIKE '%farm_id%' THEN
            RAISE EXCEPTION 'p_tenant_% is missing on ssf.% or not keyed on farm_id (is: %)', t, t, v_qual;
        END IF;
    END LOOP;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "reference_date",
                schema: "ssf",
                table: "schedule_subscriptions",
                type: "date",
                nullable: true);

            migrationBuilder.Sql(SecuritySql);
            migrationBuilder.Sql(VerifySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_schedule_migration_events ON ssf.schedule_migration_events;
ALTER TABLE ssf.schedule_migration_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_migration_events DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_user_select_schedule_subscriptions ON ssf.schedule_subscriptions;
DROP POLICY IF EXISTS p_tenant_schedule_subscriptions ON ssf.schedule_subscriptions;
ALTER TABLE ssf.schedule_subscriptions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_subscriptions DISABLE ROW LEVEL SECURITY;
");

            migrationBuilder.DropColumn(
                name: "reference_date",
                schema: "ssf",
                table: "schedule_subscriptions");
        }
    }
}
