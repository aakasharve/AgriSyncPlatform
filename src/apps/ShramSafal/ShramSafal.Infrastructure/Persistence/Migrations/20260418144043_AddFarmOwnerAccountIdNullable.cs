using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFarmOwnerAccountIdNullable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_farm_memberships_farm_id_user_id",
                schema: "ssf",
                table: "farm_memberships");

            // Phase 2: introduce the status column with the Active default
            // so existing rows are not left undefined. Backfill from the
            // legacy is_revoked flag before we drop it.
            migrationBuilder.AddColumn<int>(
                name: "status",
                schema: "ssf",
                table: "farm_memberships",
                type: "integer",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.Sql(
                "UPDATE ssf.farm_memberships SET status = 5 WHERE is_revoked = true;");

            migrationBuilder.DropColumn(
                name: "is_revoked",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.AddColumn<string>(
                name: "farm_code",
                schema: "ssf",
                table: "farms",
                type: "character varying(12)",
                maxLength: 12,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "owner_account_id",
                schema: "ssf",
                table: "farms",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "approved_by_user_id",
                schema: "ssf",
                table: "farm_memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "exited_at_utc",
                schema: "ssf",
                table: "farm_memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "invitation_id",
                schema: "ssf",
                table: "farm_memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "joined_via",
                schema: "ssf",
                table: "farm_memberships",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<DateTime>(
                name: "last_seen_at_utc",
                schema: "ssf",
                table: "farm_memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_farms_owner_account_id",
                schema: "ssf",
                table: "farms",
                column: "owner_account_id");

            migrationBuilder.CreateIndex(
                name: "ux_farms_farm_code",
                schema: "ssf",
                table: "farms",
                column: "farm_code",
                unique: true,
                filter: "farm_code IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_farm_memberships_farm_user_nonterminal",
                schema: "ssf",
                table: "farm_memberships",
                columns: new[] { "farm_id", "user_id" },
                unique: true,
                filter: "status NOT IN (5, 6)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_farms_owner_account_id",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropIndex(
                name: "ux_farms_farm_code",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropIndex(
                name: "ix_farm_memberships_farm_user_nonterminal",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "farm_code",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "owner_account_id",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "approved_by_user_id",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "exited_at_utc",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "invitation_id",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "joined_via",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "last_seen_at_utc",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "status",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.AddColumn<bool>(
                name: "is_revoked",
                schema: "ssf",
                table: "farm_memberships",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_farm_memberships_farm_id_user_id",
                schema: "ssf",
                table: "farm_memberships",
                columns: new[] { "farm_id", "user_id" },
                unique: true,
                filter: "is_revoked = false");
        }
    }
}
