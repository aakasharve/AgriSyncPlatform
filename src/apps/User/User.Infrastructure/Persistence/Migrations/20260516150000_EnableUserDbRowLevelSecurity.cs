// spec: data-principle-spine-2026-05-05/03.6
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace User.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 03 sub-phase 03.6 — enable
    /// and <c>FORCE</c> Postgres Row-Level Security on
    /// <c>public.memberships</c>, keyed on
    /// <c>current_setting('agrisync.user_id', true)::uuid</c>. Pairs
    /// with the 03.6 update to <c>TenantConnectionInterceptor</c>
    /// (third GUC <c>agrisync.user_id</c>) and the 03.6 fan-out of
    /// <c>TenantTransactionMiddleware</c> to wrap UserDbContext
    /// commands in an explicit per-request transaction.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why memberships and not users.</b> Per R1 OQ-4
    /// (decisions-log 2026-05-16): user_id GUC matches the
    /// <c>FarmId</c>/<c>OwnerAccountId</c> claim-per-tenant pattern.
    /// <c>public.users</c> is a global directory (a user's row must be
    /// readable to themselves to authenticate); <c>public.memberships</c>
    /// is the per-user authorisation surface and the right place for
    /// RLS. Future phases may add policies to <c>refresh_tokens</c> and
    /// <c>otp_challenges</c> on the same GUC.
    /// </para>
    /// <para>
    /// <b>NULL-tolerant cast.</b> The interceptor always binds
    /// <c>@__tenant_user_id</c>, but the value is the empty string
    /// when <c>TenantContext.UserId is null</c> (anonymous request,
    /// hosted job pre-elevation). <c>''::uuid</c> would throw; the
    /// policy body wraps the cast in
    /// <c>NULLIF(current_setting('agrisync.user_id', true), '')::uuid</c>
    /// so an empty string evaluates to NULL and the policy expression
    /// <c>user_id = NULL::uuid</c> evaluates to NULL (treated as
    /// false by the USING clause) — fail-closed.
    /// </para>
    /// <para>
    /// <b>FORCE.</b> Mirrors the ShramSafal pattern (03.3) so even the
    /// table owner is subject to policy evaluation. Admin scope
    /// bypass arrives in the 03.5 admin DbContext factory; until 03.5b
    /// migrates the existing <c>ElevateToAdminCrossTenant()</c>
    /// call sites (none touch UserDbContext today), the only
    /// privileged path through UserDbContext is the migration runner
    /// itself, which owns the table.
    /// </para>
    /// <para>
    /// <b>Down() is reversible</b> — drops the policy and DISABLEs
    /// RLS. Idempotent.
    /// </para>
    /// </remarks>
    public partial class EnableUserDbRowLevelSecurity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_user_memberships ON public.memberships;
CREATE POLICY p_user_memberships ON public.memberships
  USING      (user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_memberships ON public.memberships;
ALTER TABLE public.memberships DISABLE ROW LEVEL SECURITY;
");
        }
    }
}
