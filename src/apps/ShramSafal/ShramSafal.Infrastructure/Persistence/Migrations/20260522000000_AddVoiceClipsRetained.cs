// spec: voice-diary-e2e-2026-05-17 (B.8)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Voice Diary ship (voice-diary-e2e-2026-05-17) —
    /// <c>ssf.voice_clips_retained</c> holds metadata for every voice
    /// clip the user has chosen to retain beyond the 30-day local
    /// journal. Gated at write time by
    /// <c>UserConsentState.FullHistoryJournal</c> (enforced by
    /// <c>IConsentEnforcer</c> in <c>ParseVoiceInputHandler</c> +
    /// <c>PersistVoiceClipRetainedHandler</c>); once persisted, the row
    /// + S3 object survive until the user revokes consent and
    /// <c>ErasureWorker</c> drops them (DPDP §12).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Timestamp choice.</b> Latest existing migration ships at
    /// <c>20260521000000_ThirdPartyPiiControls</c>; this migration
    /// takes the next-day slot (<c>20260522000000</c>) so the natural
    /// chronological order in EF's history matches the apply order.
    /// </para>
    /// <para>
    /// <b>RLS exemption.</b> User-keyed not farm-keyed. The Phase 03
    /// RLS policy keyed on <c>agrisync.farm_id</c> would filter every
    /// row out (the consent endpoints surface only the <c>sub</c>
    /// claim, no <c>farm_id</c> claim). Defence in this ship is at the
    /// Application layer (<c>IRetainedBlobStore</c> read paths take
    /// <c>callerUserId</c>); Phase 07 layers RLS. The table name is
    /// added to <c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c>
    /// in the same envelope so the architecture test stays green.
    /// </para>
    /// <para>
    /// <b>No DELETE revoke.</b> Unlike <c>consent_audit</c> (append-
    /// only), this table MUST allow DELETE because <c>ErasureWorker</c>
    /// (Phase 08.2 + Voice Diary ship's <c>S3RetainedBlobStore</c>)
    /// removes rows as part of the DPDP §12 erasure manifest. The
    /// grant block below keeps SELECT/INSERT/UPDATE/DELETE on the
    /// table for <c>agrisync_app</c>.
    /// </para>
    /// </remarks>
    public partial class AddVoiceClipsRetained : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "voice_clips_retained",
                schema: "ssf",
                columns: table => new
                {
                    clip_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    recorded_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    s3_key = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    dek_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    iv_b64 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    auth_tag_b64 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    duration_seconds = table.Column<int>(type: "integer", nullable: false),
                    language = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    consent_audit_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_voice_clips_retained", x => x.clip_id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_voice_clips_retained_user_recorded",
                schema: "ssf",
                table: "voice_clips_retained",
                columns: new[] { "user_id", "recorded_at_utc" },
                descending: new[] { false, true });

            // Same IF EXISTS guard pattern as ConsentDomain so the
            // migration is safe to re-run on environments that bypass
            // BootstrapDbRoles (e.g. ephemeral test contexts using
            // EnsureCreatedAsync). When agrisync_app does not exist
            // the grants are skipped without error.
            migrationBuilder.Sql(@"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.voice_clips_retained TO agrisync_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "voice_clips_retained",
                schema: "ssf");
        }
    }
}
