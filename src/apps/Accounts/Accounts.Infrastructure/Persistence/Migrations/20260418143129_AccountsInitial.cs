using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounts.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AccountsInitial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "accounts");

            migrationBuilder.CreateTable(
                name: "owner_accounts",
                schema: "accounts",
                columns: table => new
                {
                    owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    account_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    primary_owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    account_type = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_owner_accounts", x => x.owner_account_id);
                });

            migrationBuilder.CreateTable(
                name: "subscriptions",
                schema: "accounts",
                columns: table => new
                {
                    subscription_id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    valid_from_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    valid_until_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    trial_ends_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    billing_provider_customer_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_subscriptions", x => x.subscription_id);
                });

            migrationBuilder.CreateTable(
                name: "owner_account_memberships",
                schema: "accounts",
                columns: table => new
                {
                    owner_account_membership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    invited_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ended_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_owner_account_memberships", x => x.owner_account_membership_id);
                    table.ForeignKey(
                        name: "FK_owner_account_memberships_owner_accounts_owner_account_id",
                        column: x => x.owner_account_id,
                        principalSchema: "accounts",
                        principalTable: "owner_accounts",
                        principalColumn: "owner_account_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_owner_account_memberships_account_user",
                schema: "accounts",
                table: "owner_account_memberships",
                columns: new[] { "owner_account_id", "user_id" },
                filter: "status <> 3");

            migrationBuilder.CreateIndex(
                name: "ix_owner_accounts_primary_owner_user_id",
                schema: "accounts",
                table: "owner_accounts",
                column: "primary_owner_user_id");

            migrationBuilder.CreateIndex(
                name: "ux_subscriptions_owner_account_active",
                schema: "accounts",
                table: "subscriptions",
                column: "owner_account_id",
                unique: true,
                filter: "status IN (1, 2)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "owner_account_memberships",
                schema: "accounts");

            migrationBuilder.DropTable(
                name: "subscriptions",
                schema: "accounts");

            migrationBuilder.DropTable(
                name: "owner_accounts",
                schema: "accounts");
        }
    }
}
