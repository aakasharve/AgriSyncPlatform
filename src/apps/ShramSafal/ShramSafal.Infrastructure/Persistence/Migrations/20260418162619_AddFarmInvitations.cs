using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFarmInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "farm_invitations",
                schema: "ssf",
                columns: table => new
                {
                    farm_invitation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    revoked_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_invitations", x => x.farm_invitation_id);
                });

            migrationBuilder.CreateTable(
                name: "farm_join_tokens",
                schema: "ssf",
                columns: table => new
                {
                    farm_join_token_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_invitation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    raw_token = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    is_revoked = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    revoked_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_join_tokens", x => x.farm_join_token_id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_farm_invitations_active_per_farm",
                schema: "ssf",
                table: "farm_invitations",
                column: "farm_id",
                unique: true,
                filter: "status = 1");

            migrationBuilder.CreateIndex(
                name: "ix_farm_join_tokens_farm_id",
                schema: "ssf",
                table: "farm_join_tokens",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ux_farm_join_tokens_token_hash",
                schema: "ssf",
                table: "farm_join_tokens",
                column: "token_hash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "farm_invitations",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "farm_join_tokens",
                schema: "ssf");
        }
    }
}
