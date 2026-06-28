using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace User.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Reshapes <c>public.refresh_tokens</c> from the bare credential table
    /// (token, user_id, created/expires/revoked) into the device-session shape
    /// (token_hash, device_id, device_name, platform, last_used_at_utc,
    /// revocation_reason, replaced_by_token_id).
    ///
    /// Safe ordering (data-prod gate):
    ///   1. Add new columns as NULLABLE (no data destruction).
    ///   2. Backfill token_hash = UPPER(ENCODE(SHA256(token::bytea), 'hex'))
    ///      — matches C# RefreshTokenHasher.Hash (Convert.ToHexString = uppercase hex).
    ///      Uses built-in sha256() (PostgreSQL 11+, no extension required).
    ///   3. Backfill device_id / platform / last_used_at_utc with legacy sentinel
    ///      values for any pre-existing rows.
    ///   4. ALTER the backfilled columns to NOT NULL.
    ///   5. Drop the old unique index on token, then drop the token column.
    ///   6. Create new indexes: unique(token_hash), (user_id,device_id),
    ///      (user_id,revoked_at_utc).
    ///
    /// RLS note: <c>20260516150000_EnableUserDbRowLevelSecurity</c> only enables
    /// RLS on <c>public.memberships</c>. No policy references the <c>token</c>
    /// column; ADD COLUMN / DROP COLUMN do not affect RLS policies.
    /// RLS on refresh_tokens remains DISABLED (as confirmed in Step 0).
    ///
    /// Down() restores the token column (nullable, no value recovery) and its
    /// unique index, then drops the new columns and indexes.
    /// </summary>
    public partial class AddDeviceSessionRefreshTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── Step 1: Add all new columns as NULLABLE ───────────────────────────
            migrationBuilder.AddColumn<string>(
                name: "token_hash",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);   // temporarily nullable for backfill

            migrationBuilder.AddColumn<string>(
                name: "device_id",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);   // temporarily nullable for backfill

            migrationBuilder.AddColumn<string>(
                name: "device_name",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "platform",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);   // temporarily nullable for backfill

            migrationBuilder.AddColumn<DateTime>(
                name: "last_used_at_utc",
                schema: "public",
                table: "refresh_tokens",
                type: "timestamp with time zone",
                nullable: true);   // temporarily nullable for backfill

            migrationBuilder.AddColumn<string>(
                name: "revocation_reason",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "replaced_by_token_id",
                schema: "public",
                table: "refresh_tokens",
                type: "uuid",
                nullable: true);

            // ── Step 2a: Backfill token_hash from existing token values ───────────
            // sha256() is built-in to PostgreSQL 11+ (no pgcrypto extension needed).
            // upper(encode(sha256(token::bytea),'hex')) == Convert.ToHexString(SHA256.HashData(UTF8.GetBytes(token)))
            //
            // The CASE guard handles the rare but real scenario of re-applying this
            // migration after a Down() was run: Down() cannot restore the original
            // token values (they are irrecoverable once the column is dropped), so
            // rows after Down() have token IS NULL. For those rows we derive a
            // placeholder hash from the row Id so the NOT NULL constraint can still
            // be satisfied. These rows are already invalidated sessions (the original
            // token is gone), so the placeholder hash will never match a real lookup.
            migrationBuilder.Sql(@"
UPDATE public.refresh_tokens
SET token_hash = CASE
    WHEN token IS NOT NULL THEN upper(encode(sha256(token::bytea), 'hex'))
    ELSE upper(encode(sha256(('revoked-sentinel:' || ""Id""::text)::bytea), 'hex'))
END
WHERE token_hash IS NULL;
");

            // ── Step 2b: Backfill device_id, platform, last_used_at_utc ──────────
            migrationBuilder.Sql(@"
UPDATE public.refresh_tokens
SET device_id        = 'legacy',
    platform         = 'unknown',
    last_used_at_utc = created_at_utc
WHERE device_id IS NULL;
");

            // ── Step 3: Alter backfilled columns to NOT NULL ──────────────────────
            migrationBuilder.AlterColumn<string>(
                name: "token_hash",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "device_id",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "platform",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

            migrationBuilder.AlterColumn<DateTime>(
                name: "last_used_at_utc",
                schema: "public",
                table: "refresh_tokens",
                type: "timestamp with time zone",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "timestamp with time zone",
                oldNullable: true);

            // ── Step 4: Drop old unique index on token, then drop token column ────
            migrationBuilder.DropIndex(
                name: "IX_refresh_tokens_token",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropIndex(
                name: "IX_refresh_tokens_user_id",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "token",
                schema: "public",
                table: "refresh_tokens");

            // ── Step 5: Create new indexes ────────────────────────────────────────
            migrationBuilder.CreateIndex(
                name: "IX_refresh_tokens_token_hash",
                schema: "public",
                table: "refresh_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_refresh_tokens_user_id_device_id",
                schema: "public",
                table: "refresh_tokens",
                columns: new[] { "user_id", "device_id" });

            migrationBuilder.CreateIndex(
                name: "IX_refresh_tokens_user_id_revoked_at_utc",
                schema: "public",
                table: "refresh_tokens",
                columns: new[] { "user_id", "revoked_at_utc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Drop new indexes
            migrationBuilder.DropIndex(
                name: "IX_refresh_tokens_token_hash",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropIndex(
                name: "IX_refresh_tokens_user_id_device_id",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropIndex(
                name: "IX_refresh_tokens_user_id_revoked_at_utc",
                schema: "public",
                table: "refresh_tokens");

            // Drop new columns
            migrationBuilder.DropColumn(
                name: "token_hash",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "device_id",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "device_name",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "platform",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "last_used_at_utc",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "revocation_reason",
                schema: "public",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "replaced_by_token_id",
                schema: "public",
                table: "refresh_tokens");

            // Restore token column (nullable — original values are irrecoverable
            // once this migration ran; schema shape is restored for EF consistency)
            migrationBuilder.AddColumn<string>(
                name: "token",
                schema: "public",
                table: "refresh_tokens",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);   // nullable because we cannot backfill the original tokens

            // Restore old indexes
            migrationBuilder.CreateIndex(
                name: "IX_refresh_tokens_token",
                schema: "public",
                table: "refresh_tokens",
                column: "token",
                unique: true,
                filter: "token IS NOT NULL");   // partial unique to allow multiple NULLs

            migrationBuilder.CreateIndex(
                name: "IX_refresh_tokens_user_id",
                schema: "public",
                table: "refresh_tokens",
                column: "user_id");
        }
    }
}
