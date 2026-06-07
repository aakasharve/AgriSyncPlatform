// spec: sync-pull-user-scoped-rls-read-path-2026-06-07
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// User-scoped READ policies on the farm-scoped DATA tables so
    /// <c>GET /sync/pull</c> (user-scoped tenancy mode — see the
    /// <c>TenantContext.SetUserScoped</c> ADR) returns a caller's OWN farm data
    /// under FORCE-RLS. Sibling of
    /// <c>20260606074635_AddUserScopedFarmReadPolicies</c>, which fixed only the
    /// farm-LIST endpoint (<c>ssf.farms</c> + <c>ssf.farm_memberships</c>); this
    /// extends the same pattern to the data tables the pull projects.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why.</b> <c>/sync/pull</c> is on
    /// <c>TenantTransactionMiddleware.SkipPathPrefixes</c> → admin-elevated → the
    /// interceptor sets no GUC → the existing <c>farm_id</c>-keyed
    /// <c>p_tenant_{t}</c> policies evaluate <c>farm_id = NULL</c> and hide every
    /// row, so the pull returns an empty snapshot even though the data is present
    /// (4 plots + 136 logs confirmed on prod, farm <c>d7b187c8</c>). The pull path
    /// now opens a transaction and <c>SET LOCAL agrisync.user_id</c> (spec R2);
    /// these PERMISSIVE <c>FOR SELECT</c> policies give that GUC something to match.
    /// </para>
    /// <para>
    /// <b>SELECT-only + additive.</b> PERMISSIVE policies OR-combine per command,
    /// so a SELECT returns rows matching EITHER the single-tenant
    /// <c>p_tenant_{t}</c> (farm_id claim) OR these user-scoped policies.
    /// INSERT/UPDATE/DELETE are untouched — the write path stays locked to the
    /// <c>farm_id</c> claim.
    /// </para>
    /// <para>
    /// <b>Seven policies (senior-architect pre-flight 2026-06-07; the spec's
    /// looser audit was corrected).</b> Five DIRECT <c>farm_id</c> tables
    /// (<c>plots</c>, <c>crop_cycles</c>, <c>daily_logs</c>, <c>cost_entries</c>,
    /// <c>attachments</c>) chain <c>farm_id → ssf.farms</c> (owner OR active
    /// member). Two CHAINED tables reach <c>farms</c> through their parent:
    /// <c>verification_events</c> via <c>daily_logs</c>
    /// (<c>daily_log_id → daily_logs."Id"</c>), <c>finance_corrections</c> via
    /// <c>cost_entries</c> (<c>cost_entry_id → cost_entries."Id"</c>). Neither
    /// carries <c>farm_id</c> and both are FORCE-RLS with farm-claim policies
    /// today (<c>20260516130000</c> / <c>20260517010000</c>), so they need their
    /// own user-scoped SELECT policy or they stay empty under user-scoped reads.
    /// <c>day_ledgers</c>, <c>price_configs</c>, <c>log_tasks</c>,
    /// <c>cost_categories</c> need nothing (non-RLS / global lookup) — verified,
    /// intentionally omitted.
    /// </para>
    /// <para>
    /// <b><c>NULLIF(..., '')::uuid</c> is REQUIRED.</b> The interceptor emits
    /// <c>SET LOCAL agrisync.user_id = ''</c> for requests with no user claim; a
    /// bare <c>::uuid</c> cast throws on the empty string. <c>NULLIF</c> coerces it
    /// to NULL → no match → fail-closed. <c>status NOT IN (5, 6)</c> excludes
    /// Revoked(5)/Exited(6), matching the sibling and
    /// <c>FarmMembershipConfiguration</c>. Parent PKs are the case-sensitive
    /// quoted <c>"Id"</c> (raw-SQL CREATE TABLE).
    /// </para>
    /// <para>
    /// <b>Down()</b> drops the seven policies only; it does NOT disable RLS (every
    /// touched table already had FORCE-RLS before this migration — additive).
    /// Idempotent <c>DROP POLICY IF EXISTS</c>. ModelSnapshot diff is empty (RLS is
    /// not a model construct); the Designer carries the same snapshot as
    /// <c>20260606074635_AddUserScopedFarmReadPolicies</c>.
    /// </para>
    /// </remarks>
    public partial class AddUserScopedDataReadPolicies : Migration
    {
        // Direct farm_id-keyed tables reached by the sync pull projection.
        private static readonly string[] DirectFarmScopedTables =
        {
            "plots",
            "crop_cycles",
            "daily_logs",
            "cost_entries",
            "attachments",
        };

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. Direct farm_id tables — chain farm_id → ssf.farms ──
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

            // ── 2. verification_events → daily_logs → farms ──────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_verification_events ON ssf.verification_events;
CREATE POLICY p_user_select_verification_events ON ssf.verification_events
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    JOIN ssf.farms f ON f.""Id"" = d.farm_id
    WHERE d.""Id"" = verification_events.daily_log_id
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

            // ── 3. finance_corrections → cost_entries → farms ────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_finance_corrections ON ssf.finance_corrections;
CREATE POLICY p_user_select_finance_corrections ON ssf.finance_corrections
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.cost_entries ce
    JOIN ssf.farms f ON f.""Id"" = ce.farm_id
    WHERE ce.""Id"" = finance_corrections.cost_entry_id
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP POLICY IF EXISTS p_user_select_finance_corrections ON ssf.finance_corrections;");
            migrationBuilder.Sql(@"DROP POLICY IF EXISTS p_user_select_verification_events ON ssf.verification_events;");
            foreach (var t in DirectFarmScopedTables)
            {
                migrationBuilder.Sql($@"DROP POLICY IF EXISTS p_user_select_{t} ON ssf.{t};");
            }
        }
    }
}
