// spec: plr-d10-redesign-real-integration-2026-10-25 (lane GRP-1a; founder: owner-named groups of plots, 2026-11-20)
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 - lane GRP-1a: <c>ssf.plots.group_name</c>, the owner's own label for a cluster of
    /// plots ("विहिरीजवळचे"). A group is ONLY this label (no groups table, no group id, no order, no colour): plots of one crop with the same
    /// trimmed name are the group.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. <c>Up()</c> adds ONE nullable <c>character varying(30)</c> column to
    /// <c>ssf.plots</c> and nothing else: no default, no back-fill (every existing plot keeps <c>NULL</c> = "no group"), no index, no constraint,
    /// no change to any existing row, policy or grant. The deployed binary never names the column, so it runs unchanged against the migrated
    /// schema (P11), and a phone that never heard of groups reads <c>NULL</c> as no group.</para>
    ///
    /// <para><b>Row security: nothing to add (read, not assumed).</b> The plots policies are per ROW and name only <c>farm_id</c>:
    /// <c>p_tenant_plots</c> (<c>20260516130000_EnableRowLevelSecurity</c>: <c>farm_id = agrisync.farm_id</c>, USING and WITH CHECK) and
    /// <c>p_user_select_plots</c> (<c>20260607120000_AddUserScopedDataReadPolicies</c>: SELECT only, through the farm and its memberships).
    /// A new column is covered by both with no edit, and <c>agrisync_app</c> already holds table-level SELECT / INSERT / UPDATE / DELETE on every
    /// <c>ssf</c> table (<c>20260515090000_BootstrapDbRoles</c>; plots is current state, not an append-only ledger). The new write (a plot's group)
    /// runs under the farm scope, so <c>p_tenant_plots</c>'s WITH CHECK passes for a member's own farm only.</para>
    ///
    /// <para><b>Down() is DATA-DESTROYING by design.</b> It drops the column, so a rollback DELETES every group name the owners typed since
    /// <c>Up()</c> ran (the plots, their names, areas and everything else stay). The deploy rollback plan therefore relies on the pre-deploy
    /// SNAPSHOT, not on <c>Down()</c> - the same stance as <c>20261119105639_AddInputUseFacts</c>. It touches no <c>ssf.audit_events</c> object,
    /// no ledger and no grant; re-running <c>Up()</c> recreates the column empty.</para>
    /// </summary>
    public partial class AddPlotGroupName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "group_name",
                schema: "ssf",
                table: "plots",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "group_name",
                schema: "ssf",
                table: "plots");
        }
    }
}
