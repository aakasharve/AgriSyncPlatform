using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// LABOUR_PHASE2 migration ② — the owner's explicit grant of labour-record
    /// management, on the table that already holds farm access.
    /// </summary>
    /// <remarks>
    /// Founder decision O-4 (2026-08-12): <i>"Owner always; Mukadam by default;
    /// others only when explicitly granted, via the existing farm
    /// access-management experience. No second role system, no subscription
    /// entitlements."</i> One additive boolean on <c>ssf.farm_memberships</c> is
    /// the whole storage change.
    ///
    /// <para><b>Two designs were rejected, and naming them is cheaper than
    /// re-deriving them.</b> A <c>farm_member_capabilities</c> grant table would
    /// have cost ~70–90 lines plus two new RLS policies to buy a flexibility
    /// nothing needs — there is exactly one capability. Extending
    /// <c>AppRole</c> was worse: roles are identity-shaped ("who this person is
    /// on the farm") and already carry nine values; a capability is not an
    /// identity, and inventing <c>Approver</c>/<c>Verifier</c> would create a
    /// second, parallel permission system for one flag.</para>
    ///
    /// <para><b>No RLS change, and that is verified rather than assumed.</b>
    /// <c>ssf.farm_memberships</c> is one of the eleven direct farm_id-keyed
    /// tables in <c>20260516130000_EnableRowLevelSecurity</c>, which gave it
    /// <c>p_tenant_farm_memberships</c> — <c>FOR ALL</c> (no FOR clause) with
    /// BOTH <c>USING (farm_id = …)</c> and <c>WITH CHECK (farm_id = …)</c>,
    /// later NULLIF-hardened in place by <c>20260609144905</c>. A policy filters
    /// on the columns it names; it names <c>farm_id</c> and nothing else, so a
    /// new column is inside the existing fence on both the read and the write
    /// side the moment it exists. The sibling <c>p_user_select_memberships</c>
    /// (<c>20260606074635</c>) is PERMISSIVE and <c>FOR SELECT</c> only — it
    /// widens READS of the caller's own rows across farms and grants no write
    /// path at all, which is exactly why the grant handler asserts the farm in
    /// application code as well (doctrine E4).</para>
    ///
    /// <para><b>No index.</b> The column is only ever read alongside
    /// <c>(farm_id, user_id)</c>, which
    /// <c>ix_farm_memberships_farm_user_nonterminal</c> already covers. An index
    /// on a boolean with an overwhelmingly dominant value would cost every
    /// membership write and buy nothing.</para>
    ///
    /// <para><b>Every existing row reads <c>false</c>, and that is TRUE, not a
    /// default standing in for missing knowledge.</b> No grant has ever been
    /// issued anywhere in this product — there was no grant endpoint until this
    /// phase, and <c>FarmMembership.ChangeRole</c> still has zero production
    /// callers. So "never granted" is the literal history of every row, and
    /// there is nothing to back-fill (doctrine P4: we are not inventing a
    /// decision nobody made).</para>
    ///
    /// <para><b>The <c>Down()</c> DROPS the column, and unlike migrations ① and
    /// ③ that is the honest choice here.</b> Both of those refuse rollback:
    /// ①(<c>AddDailyLogPlotIdsAndScope</c>) because restoring
    /// <c>plot_id NOT NULL</c> would have had to INVENT a plot for exactly the
    /// farm-wide rows it exists to make honest, and ③
    /// (<c>AddLabourAssignmentNotes</c>) because dropping the column would
    /// DESTROY the farmer's own words with no second copy anywhere. Neither
    /// applies to this column, for three reasons that were checked, not assumed:
    /// <list type="number">
    /// <item><b>Nothing is fabricated.</b> Removing the column removes a
    /// capability; the effective rule falls back to owner-tier + Mukadam. The
    /// rollback direction is strictly MORE restrictive — nobody silently gains
    /// access, which is the failure mode that would make a silent rollback
    /// dangerous.</item>
    /// <item><b>Nothing farmer-asserted is lost.</b> This is an administrative
    /// decision about access, not a record of what happened on the farm. It is
    /// re-assertable by its owner in one tap, unlike a note nobody can retype
    /// because nobody remembers it.</item>
    /// <item><b>The history survives the rollback.</b> Every grant and revoke
    /// writes an <c>ssf.audit_events</c> row
    /// (<c>LabourManagementGranted</c>/<c>LabourManagementRevoked</c>, with
    /// actor, farm, target and device provenance) in the SAME unit of work as
    /// the column write. Dropping the column does not touch that table, so
    /// after a rollback the system can still explain who was trusted and when —
    /// doctrine P3 is satisfied by the audit trail, not by this column.</item>
    /// </list>
    /// If a future change makes any one of those three false — a second
    /// capability, a grant that is not audited, or a semantic where absence
    /// means something other than "not granted" — this <c>Down()</c> must be
    /// revisited before that change ships.</para>
    ///
    /// <para>Ordering: timestamp <c>20260813081843</c> sorts after the file-chain
    /// head <c>20260813053429_AddLabourAssignmentNotes</c> (migration ③), which
    /// itself lands after migration ① and all five August 2026 Labour V1
    /// migrations. Verified against the folder listing, not assumed.</para>
    /// </remarks>
    public partial class AddFarmMembershipLabourCapability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "can_manage_labour_records",
                schema: "ssf",
                table: "farm_memberships",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "can_manage_labour_records",
                schema: "ssf",
                table: "farm_memberships");
        }
    }
}
