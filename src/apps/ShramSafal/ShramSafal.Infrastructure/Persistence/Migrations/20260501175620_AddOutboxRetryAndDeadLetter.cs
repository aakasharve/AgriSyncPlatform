using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOutboxRetryAndDeadLetter : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AttemptCount",
                schema: "ssf",
                table: "outbox_messages",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeadLetteredAt",
                schema: "ssf",
                table: "outbox_messages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_outbox_messages_DeadLetteredAt",
                schema: "ssf",
                table: "outbox_messages",
                column: "DeadLetteredAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_outbox_messages_DeadLetteredAt",
                schema: "ssf",
                table: "outbox_messages");

            migrationBuilder.DropColumn(
                name: "AttemptCount",
                schema: "ssf",
                table: "outbox_messages");

            migrationBuilder.DropColumn(
                name: "DeadLetteredAt",
                schema: "ssf",
                table: "outbox_messages");
        }
    }
}
