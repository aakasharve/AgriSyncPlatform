// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — lets a person who TYPED a farm's code find
    /// that one farm, and nothing else, so <c>POST /shramsafal/join/by-code</c> can create a join
    /// request. The caller is by definition not a member yet, so every existing
    /// <c>ssf.farms</c> read policy hides the row from them: <c>p_tenant_farms</c> keys on
    /// <c>agrisync.farm_id</c> (unknown until the farm is found) and <c>p_user_select_farms</c>
    /// on ownership / membership (which the joiner does not have).
    ///
    /// <para><b>What it adds.</b> One PERMISSIVE, <c>FOR SELECT</c>-only policy keyed on a new
    /// transaction-local GUC, <c>agrisync.join_code</c>. PERMISSIVE policies OR together, so a
    /// read now ALSO returns the row whose <c>farm_code</c> equals that GUC. INSERT / UPDATE /
    /// DELETE are untouched: the write path stays locked to the farm claim.</para>
    ///
    /// <para><b>Why it widens nothing in practice.</b> The GUC is unset (NULL) or empty on every
    /// request except the join-by-code one, and <c>NULLIF(…, '')</c> turns the empty case into
    /// NULL, so <c>farm_code = NULL</c> matches no row — the same NULLIF discipline as
    /// <c>20260609144905_NullifHardenTenantGucRlsPolicies</c>. The GUC is written only by
    /// <c>JoinCodeTenantScope</c> (in the file <c>RlsIdentityScopeRules.GucWriteAllowlist</c>
    /// already pins), only with a well-formed code, and it is cleared before the farm scope opens.
    /// A row is visible only to a transaction that already KNOWS its code. Lookups use the
    /// existing unique index <c>ux_farms_farm_code</c>.</para>
    ///
    /// <para><b>Chosen over an RLS-exempt <c>ssf.farm_join_codes</c> table</b> (the plan's other
    /// option): that table would hand every farm's code to any query the app role runs, and a
    /// 6-character code cannot be protected by hashing. See <c>JoinCodeTenantScope</c>.</para>
    ///
    /// <para><b>Behaviour classification (E8).</b> Additive and reversible: no column, no data,
    /// no existing policy changed; <c>Down()</c> drops the one policy. An older binary run
    /// against the migrated schema never sets the GUC, so THIS POLICY contributes nothing to
    /// it. That is not the whole rollback story: the typed-code REQUESTS the new route stores
    /// (PendingApproval + SelfJoin seats) are mistaken for members by every older binary, so a
    /// code rollback past this release first needs
    /// <c>src/AgriSync.Bootstrapper/Scripts/end-typed-code-join-requests.sql</c> — see the E8 note
    /// on <c>20261025204459_RequireActiveMembershipForUserScopedDataReads</c>.</para>
    /// </summary>
    public partial class AddFarmJoinCodeReadPolicy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_join_code_select_farms ON ssf.farms;
CREATE POLICY p_join_code_select_farms ON ssf.farms
  FOR SELECT
  USING (farm_code = NULLIF(current_setting('agrisync.join_code', true), ''));
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP POLICY IF EXISTS p_join_code_select_farms ON ssf.farms;");
        }
    }
}
