// spec: getmyfarms-user-scoped-rls-read-path-2026-06-06
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// User-scoped READ policies so <c>GET /shramsafal/farms/mine</c> can list a
    /// caller's OWN farms. That route is on
    /// <c>TenantTransactionMiddleware.SkipPathPrefixes</c> → admin-elevated →
    /// <c>TenantConnectionInterceptor</c> injects NO GUC → the existing
    /// <c>farm_id</c>-keyed <c>p_tenant_farms</c> policy evaluates
    /// <c>"Id" = NULL</c> and hides every row (returns <c>200 []</c> → forced
    /// onboarding wizard for EVERY user since 2026-05-16).
    ///
    /// <para>
    /// Fix: two PERMISSIVE <c>FOR SELECT</c> policies keyed on
    /// <c>agrisync.user_id</c>. PERMISSIVE policies OR-combine per command, so a
    /// SELECT now returns rows matching EITHER the farm_id policy OR these
    /// user-scoped ones — additive. INSERT/UPDATE/DELETE are untouched (these
    /// are SELECT-only), so the write path stays locked to the single-tenant
    /// <c>farm_id</c> claim. The read path
    /// (<c>ShramSafalRepository.GetMyFarmsAsync</c>) opens its own transaction
    /// and <c>SET LOCAL agrisync.user_id</c> so these policies have a value to
    /// key on even though the interceptor stays in admin no-op mode.
    /// </para>
    ///
    /// <para>
    /// <b><c>NULLIF(..., '')::uuid</c> is REQUIRED.</b> The interceptor emits
    /// <c>SET LOCAL agrisync.user_id = ''</c> for every farm-scoped request that
    /// has no user claim (TenantConnectionInterceptor.cs:116,121). A bare
    /// <c>current_setting('agrisync.user_id', true)::uuid</c> — as used by the
    /// pre-existing <c>p_user_correction_events</c>
    /// (<c>20260517010000_AddDeferredAuditRls</c>) — would throw
    /// <c>invalid input syntax for uuid: ""</c> on EVERY <c>ssf.farms</c> read.
    /// <c>NULLIF</c> coerces the empty string to NULL, the <c>= NULL</c>
    /// comparison yields NULL (treated as no-match by the USING clause), and the
    /// policy contributes zero rows when no user is in scope.
    /// </para>
    ///
    /// <para>
    /// <c>farms</c> keys on its case-sensitive quoted <c>"Id"</c> column (raw-SQL
    /// CREATE TABLE in <c>20260222080909_AddAuditEvents</c>). The membership
    /// EXISTS branch surfaces farms the caller is an active member of (owner OR
    /// worker); <c>status NOT IN (5, 6)</c> excludes Revoked(5)/Exited(6),
    /// matching the partial unique index in <c>FarmMembershipConfiguration</c>.
    /// <c>Down()</c> drops both policies; idempotent <c>DROP POLICY IF EXISTS</c>.
    /// </para>
    /// </summary>
    public partial class AddUserScopedFarmReadPolicies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── ssf.farms — caller's OWN farms (owner OR active member) ──
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_farms ON ssf.farms;
CREATE POLICY p_user_select_farms ON ssf.farms
  FOR SELECT
  USING (
    owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM ssf.farm_memberships m
      WHERE m.farm_id = farms.""Id""
        AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        AND m.status NOT IN (5, 6)
    )
  );
");

            // ── ssf.farm_memberships — caller's OWN membership rows ──────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_memberships ON ssf.farm_memberships;
CREATE POLICY p_user_select_memberships ON ssf.farm_memberships
  FOR SELECT
  USING (user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP POLICY IF EXISTS p_user_select_farms ON ssf.farms;");
            migrationBuilder.Sql(@"DROP POLICY IF EXISTS p_user_select_memberships ON ssf.farm_memberships;");
        }
    }
}
