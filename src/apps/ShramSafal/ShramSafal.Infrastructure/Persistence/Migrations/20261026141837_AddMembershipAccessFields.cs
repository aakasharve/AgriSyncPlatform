using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner's decisions about a person become
    /// data: five NULLABLE columns on <c>ssf.farm_memberships</c>, no default, no backfill.
    /// <list type="bullet">
    /// <item><c>permissions</c> — the owner's stored permission choice (bitmask,
    /// <c>FarmPermission</c>); NULL = the role's defaults, which is what every existing row
    /// keeps meaning (P11).</item>
    /// <item><c>status_reason</c> (max 500), <c>status_changed_by_user_id</c>,
    /// <c>status_changed_at_utc</c> — the last approve / decline / pause / restore / remove, who
    /// and why (the reason is shown to a paused person).</item>
    /// <item><c>access_changed_at_utc</c> — when what the person may read or do last changed
    /// (step 4 resets the pull cursor from it).</item>
    /// </list>
    /// No index (read beside (farm_id, user_id) only), no RLS change (policies name rows, not
    /// columns), no grant (privileges are per table). Older binaries never read these columns.
    /// <para><b>Rollback (E8):</b> Down() drops the five columns. A rollback to the step-1 binary
    /// keeps every pause / removal in force (status is the only gate it reads). A rollback PAST
    /// step 1 counts any seat that has not ended as a member, so Suspended seats and the
    /// PendingApproval seats a stopped person's QR scan now makes would read the farm again:
    /// end them first (extend <c>Scripts/end-typed-code-join-requests.sql</c>).</para>
    /// </summary>
    public partial class AddMembershipAccessFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "access_changed_at_utc",
                schema: "ssf",
                table: "farm_memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "permissions",
                schema: "ssf",
                table: "farm_memberships",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "status_changed_at_utc",
                schema: "ssf",
                table: "farm_memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "status_changed_by_user_id",
                schema: "ssf",
                table: "farm_memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "status_reason",
                schema: "ssf",
                table: "farm_memberships",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "access_changed_at_utc",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "permissions",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "status_changed_at_utc",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "status_changed_by_user_id",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "status_reason",
                schema: "ssf",
                table: "farm_memberships");
        }
    }
}
