using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOwnerConfirmationEvidence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "confirmed_log_version",
                schema: "ssf",
                table: "verification_events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "review_basis",
                schema: "ssf",
                table: "verification_events",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "content_version",
                schema: "ssf",
                table: "daily_logs",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<Guid>(
                name: "voice_clip_id",
                schema: "ssf",
                table: "daily_logs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_verification_events_review_basis",
                schema: "ssf",
                table: "verification_events",
                sql: "review_basis IS NULL OR review_basis IN ('heard', 'read')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_verification_events_review_basis",
                schema: "ssf",
                table: "verification_events");

            migrationBuilder.DropColumn(
                name: "confirmed_log_version",
                schema: "ssf",
                table: "verification_events");

            migrationBuilder.DropColumn(
                name: "review_basis",
                schema: "ssf",
                table: "verification_events");

            migrationBuilder.DropColumn(
                name: "content_version",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "voice_clip_id",
                schema: "ssf",
                table: "daily_logs");
        }
    }
}
