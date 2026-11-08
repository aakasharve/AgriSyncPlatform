// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-1F)
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 lane L8b-1F (R5, R7; founder D-82, D-91) - what a plot's chosen schedule is, and whether it was checked when chosen.
    ///
    /// <para><b>What it adds.</b> Two NULLABLE columns on <c>ssf.schedule_subscriptions</c>: <c>origin</c> varchar(8)
    /// (<c>Outside|Own</c>; NULL = chosen before this lane, read as Outside; L8b-3 backfills it) and <c>check_state_at_adopt</c>
    /// varchar(12) (<c>Checked|NotChecked</c>; NULL = chosen before this lane), each with a CHECK that holds only its names.</para>
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. No existing row, policy, grant, index or
    /// constraint changes; the table keeps its row-level security and its table-level grants (they cover the new columns). The
    /// currently deployed binary never names either column, so it runs unchanged against the migrated schema (P11).</para>
    ///
    /// <para><b>Down()</b> drops the two CHECKs and the two columns: it DESTROYS only the marks (which subscriptions were
    /// Outside or Own, and which were Checked or NotChecked when chosen). Every subscription itself, its schedule, state and
    /// day 0 remain. L8b-3's slot CHECK reads <c>origin</c>, so its <c>Down()</c> must run first.</para>
    /// </summary>
    public partial class AddScheduleSubscriptionOriginAndCheck : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "check_state_at_adopt",
                schema: "ssf",
                table: "schedule_subscriptions",
                type: "character varying(12)",
                maxLength: 12,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "origin",
                schema: "ssf",
                table: "schedule_subscriptions",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_sched_sub_check_state_at_adopt",
                schema: "ssf",
                table: "schedule_subscriptions",
                sql: "check_state_at_adopt IS NULL OR check_state_at_adopt IN ('Checked','NotChecked')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_sched_sub_origin",
                schema: "ssf",
                table: "schedule_subscriptions",
                sql: "origin IS NULL OR origin IN ('Outside','Own')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_sched_sub_check_state_at_adopt",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_sched_sub_origin",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.DropColumn(
                name: "check_state_at_adopt",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.DropColumn(
                name: "origin",
                schema: "ssf",
                table: "schedule_subscriptions");
        }
    }
}
