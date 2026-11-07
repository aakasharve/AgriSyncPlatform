using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace User.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85). The one-time
    /// "is this your account?" question on a new phone rides the existing session registry, <c>public.refresh_tokens</c>
    /// (one row per sign-in, keyed by user + device id); no second device table.
    /// <list type="bullet">
    /// <item><c>device_check</c> NULL = the session is not held, so its device id is a KNOWN phone for the account;
    /// <c>AskedAfterSmsCode</c> / <c>AskedAfterPassword</c> = held until the phone answers; <c>Declined</c> = the person
    /// said "नाही" (the session was ended; the row is ShramSafal support's "number may have changed hands" mark).</item>
    /// <item><c>device_check_answered_at_utc</c> = when he answered.</item>
    /// </list>
    /// <para><b>Existing rows (P11):</b> both columns are added NULL, so every phone signed in before this migration —
    /// an installed 1.0.17 included — is known and is never asked. The placeholder ids <c>unknown</c> / <c>legacy</c>
    /// never count as a phone (NewPhoneQuestion). Additive only: no row is rewritten, no index, policy or grant
    /// changes (RLS on refresh_tokens stays as it was). Down() drops the two columns and the CHECK.</para>
    /// </summary>
    public partial class AddNewPhoneQuestion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "device_check",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "device_check_answered_at_utc",
                schema: "public",
                table: "refresh_tokens",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql(@"
ALTER TABLE public.refresh_tokens
    ADD CONSTRAINT ck_refresh_tokens_device_check
    CHECK (device_check IS NULL OR device_check IN ('AskedAfterSmsCode', 'AskedAfterPassword', 'Declined'));
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE public.refresh_tokens DROP CONSTRAINT IF EXISTS ck_refresh_tokens_device_check;");

            migrationBuilder.DropColumn(
                name: "device_check",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "device_check_answered_at_utc",
                schema: "public",
                table: "refresh_tokens");
        }
    }
}
