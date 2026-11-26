// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-177; founder 27 Nov 2026, B1.4: "an owner switch for each farm; off unless the owner turns it on")
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 repair D-177 - the farm's own-bill switch: <c>ssf.farms.reviewer_may_approve_own_bill</c>, may a person who checks money approve a bill he
    /// made himself. Kept apart from <c>AddFarmSetup</c> so each can be reviewed and rolled back alone.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. One boolean column, NOT NULL with DEFAULT false: every farm, old and new, is OFF
    /// until its primary owner turns it on. The currently deployed binary never names the column and its INSERTs get the default, so it runs unchanged against
    /// the migrated schema (P11) and keeps the stricter rule (nobody approves his own bill; the owner may). No policy, grant, index or other column changes: the
    /// column rides the row security and the grants <c>ssf.farms</c> already has.</para>
    ///
    /// <para><b>Down() REFUSES while any farm has the switch on</b> (<see cref="DownRefusalSql"/>): dropping the column would silently take back a rule an owner
    /// set for his farm. With every farm off it drops the column and nothing else.</para>
    /// </summary>
    public partial class AddFarmOwnBillApprovalSwitch : Migration
    {
        /// <summary>Down()'s refusal (E8). Row security is switched off for the count so a runner subject to it cannot see no farm where there is one.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_on bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_on FROM ssf.farms WHERE reviewer_may_approve_own_bill;
    IF v_on > 0 THEN
        RAISE EXCEPTION 'Down refused: % farm(s) have the own-bill approval switch turned on by their owner, and rolling back would take that rule back. Turn it off deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_on;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "reviewer_may_approve_own_bill",
                schema: "ssf",
                table: "farms",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently takes back a rule an owner set. Raises (and so changes nothing) while any farm has the switch on.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropColumn(
                name: "reviewer_may_approve_own_bill",
                schema: "ssf",
                table: "farms");
        }
    }
}
