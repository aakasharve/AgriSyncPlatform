using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounts.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSubscriptionWebhookEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "subscription_webhook_events",
                schema: "accounts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider_event_id = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    event_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    subscription_id = table.Column<Guid>(type: "uuid", nullable: true),
                    received_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: false),
                    raw_payload = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_subscription_webhook_events", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_subscription_webhook_events_provider_event_id",
                schema: "accounts",
                table: "subscription_webhook_events",
                column: "provider_event_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "subscription_webhook_events",
                schema: "accounts");
        }
    }
}
