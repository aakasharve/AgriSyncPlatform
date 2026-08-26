// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.3
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// §P0.3 — enrol <c>ssf.farm_boundaries</c> in the per-tenant RLS gate.
    ///
    /// <para>
    /// <b>What the table holds.</b> A farmer's drawn field outline
    /// (<c>polygon_geo_json</c>), the mapped acreage every area-derived number
    /// is computed from, and the owner account it belongs to. It shipped in
    /// <c>20260424113438_AddFarmGeographyFoundation</c> with no policy and sat
    /// on the RLS exemption allowlist, whose justification claimed the table
    /// was "accessed only via that join … no direct SELECT path exists". That
    /// was false from the day the table shipped:
    /// <c>ShramSafalRepository.GetActiveFarmBoundaryAsync</c> selects it
    /// directly. The allowlist entry is removed in the same change.
    /// </para>
    ///
    /// <para>
    /// <b>Doctrine F8 does not apply.</b> The tenant column already exists —
    /// <c>farm_id uuid NOT NULL</c>, with <c>ix_farm_boundaries_farm_id_is_active</c>
    /// behind it — so this is a DIRECT policy, not an <c>EXISTS</c>-join. The
    /// cast is to <c>uuid</c> (never <c>::text</c>) so that index stays usable.
    /// </para>
    ///
    /// <para>
    /// <b>House shape, matched not invented.</b> The <c>NULLIF(current_setting(
    /// 'agrisync.farm_id', true), '')::uuid</c> wrap is the form
    /// <c>20260609144905_NullifHardenTenantGucRlsPolicies</c> applied across the
    /// schema and that every table added since (<c>field_operators</c>,
    /// <c>routine_patterns</c>, …) has carried from day one. An empty-string GUC
    /// coerces to NULL — matching nothing — rather than raising <c>22P02</c>;
    /// an UNSET GUC already returns NULL from <c>current_setting(…, true)</c>
    /// without the wrap. Both fail closed.
    /// </para>
    ///
    /// <para>
    /// 🛑 <b>Why <c>FORCE</c>, and the justification is TABLE OWNERSHIP.</b>
    /// On <c>agrisync_dev_v2</c> and production, <c>pg_class.relowner</c> for
    /// <c>ssf.farm_boundaries</c> resolves to <c>agrisync_app</c> — the role the
    /// API itself connects as — and <b>a table owner bypasses <c>ENABLE</c>-only
    /// RLS</b>. Without <c>FORCE</c> the policy below would be inert in exactly
    /// the process it exists to constrain. Verifiable in one query:
    /// <code>
    /// SELECT pg_get_userbyid(relowner) FROM pg_class
    ///  WHERE oid = 'ssf.farm_boundaries'::regclass;   -- agrisync_app
    /// </code>
    /// Neither role attribute is the reason (<c>rolsuper = f</c>,
    /// <c>rolbypassrls = f</c>).
    /// </para>
    ///
    /// <para>
    /// <b>ONE policy, deliberately.</b> No permissive user-scoped SELECT policy
    /// is added here. Postgres OR-s permissive policies, so a second one would
    /// silently re-open what this closes (E4: visible is not authorised). Add
    /// one only when geometry read-back actually ships, and only with its own
    /// justification.
    /// </para>
    ///
    /// <para>
    /// <b>Ordering.</b> This migration is safe only because
    /// <c>PUT /shramsafal/farms/{farmId}/boundary</c> now establishes tenant
    /// scope via <c>ICallerFarmTenantScope</c> (same change). Landing the policy
    /// against the unscoped route would have filtered the prior-boundary read to
    /// nothing, and <c>UpdateFarmBoundaryHandler</c>'s <c>?? 0</c> / <c>?.</c>
    /// would then have reset the version and skipped the archive — silently.
    /// </para>
    ///
    /// <para>
    /// <b>Down()</b> drops the policy and disables RLS, restoring the previous
    /// (unprotected) state for local-dev parity. Production rollback is
    /// snapshot-restore per the Phase 03 plan.
    /// </para>
    /// </summary>
    public partial class AddFarmBoundariesRls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ssf.farm_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_boundaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_farm_boundaries ON ssf.farm_boundaries;
CREATE POLICY p_tenant_farm_boundaries ON ssf.farm_boundaries
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
");

            // Fail loudly on the clone dry-run if any of the three statements
            // did not take. A table that is ENABLEd but not FORCEd, or that
            // carries the policy without either flag, would report success here
            // while leaving the application role — which OWNS this table on
            // every real cluster — completely unconstrained.
            migrationBuilder.Sql(@"
DO $$
DECLARE
    v_enabled boolean;
    v_forced  boolean;
    v_qual    text;
BEGIN
    SELECT c.relrowsecurity, c.relforcerowsecurity
      INTO v_enabled, v_forced
      FROM pg_class c
     WHERE c.oid = 'ssf.farm_boundaries'::regclass;

    IF NOT v_enabled THEN
        RAISE EXCEPTION 'ssf.farm_boundaries did not ENABLE ROW LEVEL SECURITY';
    END IF;

    IF NOT v_forced THEN
        RAISE EXCEPTION
            'ssf.farm_boundaries did not FORCE ROW LEVEL SECURITY — the table owner (agrisync_app on every real cluster) would bypass the policy';
    END IF;

    SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_qual
      FROM pg_policy pol
      JOIN pg_class c     ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ssf' AND c.relname = 'farm_boundaries'
       AND pol.polname = 'p_tenant_farm_boundaries';

    IF v_qual IS NULL THEN
        RAISE EXCEPTION 'p_tenant_farm_boundaries is missing on ssf.farm_boundaries';
    END IF;

    IF v_qual NOT LIKE '%farm_id%' THEN
        RAISE EXCEPTION
            'p_tenant_farm_boundaries is not keyed on farm_id (is: %)', v_qual;
    END IF;
END $$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_farm_boundaries ON ssf.farm_boundaries;
ALTER TABLE ssf.farm_boundaries NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_boundaries DISABLE ROW LEVEL SECURITY;
");
        }
    }
}
