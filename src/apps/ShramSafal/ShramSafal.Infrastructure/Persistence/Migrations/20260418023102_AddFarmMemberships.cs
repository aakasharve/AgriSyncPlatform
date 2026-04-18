using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFarmMemberships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "farm_memberships",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    granted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    is_revoked = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    revoked_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_memberships", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_farm_memberships_farm_id",
                schema: "ssf",
                table: "farm_memberships",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "IX_farm_memberships_farm_id_user_id",
                schema: "ssf",
                table: "farm_memberships",
                columns: new[] { "farm_id", "user_id" },
                unique: true,
                filter: "is_revoked = false");

            migrationBuilder.CreateIndex(
                name: "IX_farm_memberships_user_id",
                schema: "ssf",
                table: "farm_memberships",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "farm_memberships",
                schema: "ssf");
        }
    }
}
