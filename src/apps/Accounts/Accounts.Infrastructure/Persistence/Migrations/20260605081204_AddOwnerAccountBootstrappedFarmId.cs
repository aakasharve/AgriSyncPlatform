using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounts.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOwnerAccountBootstrappedFarmId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "bootstrapped_farm_id",
                schema: "accounts",
                table: "owner_accounts",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "bootstrapped_farm_id",
                schema: "accounts",
                table: "owner_accounts");
        }
    }
}
