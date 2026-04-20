using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounts.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAffiliationTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "benefit_ledger_entries",
                schema: "accounts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_growth_event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    benefit_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    quantity = table.Column<int>(type: "integer", nullable: false),
                    unit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: false),
                    status_changed_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_benefit_ledger_entries", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "growth_events",
                schema: "accounts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<int>(type: "integer", nullable: false),
                    reference_id = table.Column<Guid>(type: "uuid", nullable: false),
                    metadata = table.Column<string>(type: "text", nullable: true),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_growth_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "referral_codes",
                schema: "accounts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_referral_codes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "referral_relationships",
                schema: "accounts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    referrer_owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    referred_owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    referral_code_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: false),
                    qualified_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_referral_relationships", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_growth_events_type_reference",
                schema: "accounts",
                table: "growth_events",
                columns: new[] { "event_type", "reference_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_referral_codes_active_code",
                schema: "accounts",
                table: "referral_codes",
                column: "code",
                unique: true,
                filter: "is_active = TRUE");

            migrationBuilder.CreateIndex(
                name: "ux_referral_codes_owner_active",
                schema: "accounts",
                table: "referral_codes",
                column: "owner_account_id",
                unique: true,
                filter: "is_active = TRUE");

            migrationBuilder.CreateIndex(
                name: "ux_referral_relationships_referred",
                schema: "accounts",
                table: "referral_relationships",
                column: "referred_owner_account_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "benefit_ledger_entries",
                schema: "accounts");

            migrationBuilder.DropTable(
                name: "growth_events",
                schema: "accounts");

            migrationBuilder.DropTable(
                name: "referral_codes",
                schema: "accounts");

            migrationBuilder.DropTable(
                name: "referral_relationships",
                schema: "accounts");
        }
    }
}
