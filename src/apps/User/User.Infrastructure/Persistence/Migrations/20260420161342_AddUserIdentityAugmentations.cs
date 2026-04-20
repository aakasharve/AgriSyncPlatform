using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace User.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserIdentityAugmentations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "auth_mode",
                schema: "public",
                table: "users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "phone_verified_at_utc",
                schema: "public",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "preferred_language",
                schema: "public",
                table: "users",
                type: "character varying(4)",
                maxLength: 4,
                nullable: false,
                defaultValue: "mr");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "auth_mode",
                schema: "public",
                table: "users");

            migrationBuilder.DropColumn(
                name: "phone_verified_at_utc",
                schema: "public",
                table: "users");

            migrationBuilder.DropColumn(
                name: "preferred_language",
                schema: "public",
                table: "users");
        }
    }
}
