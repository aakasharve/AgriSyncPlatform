using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.3 (data-eng brief
    /// Theme B-2, Safeguard B2) — golden-set feedback-loop candidate
    /// table. One row per farmer-correction event the
    /// <c>GoldenSetFeedbackWorker</c> captures.
    ///
    /// <para>
    /// <b>Storage.</b> AgriLog payloads are stored as <c>jsonb</c> so
    /// future analytics can index them; transcript snapshots are
    /// <c>text</c> (nullable — not every correction carries an audio
    /// source). The two json columns are append-only at the entity
    /// level (no mutators after <c>Create</c>).
    /// </para>
    /// <para>
    /// <b>Unique key.</b> <c>(audio_content_hash, correction_type)</c>
    /// — the worker upserts via <c>ON CONFLICT DO NOTHING</c> so
    /// repeated runs over the same correction event are idempotent.
    /// </para>
    /// <para>
    /// <b>RLS posture.</b> Training-corpus surface;
    /// <c>user_id</c> + <c>farm_id</c> present but writes are
    /// admin-elevated via the worker. Added to
    /// <c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c> in the
    /// same envelope so the architecture test stays green. Same
    /// posture as <c>voice_clips_retained</c>.
    /// </para>
    /// <para>
    /// <b>Erasure cascade.</b> The DPDP §12 worker drops rows where
    /// <c>user_id</c> matches the target user — see Task 3.4's
    /// extension to <c>ErasureWorker.cs</c>.
    /// </para>
    /// <para>
    /// <b>Apply policy.</b> Per the envelope: do NOT apply this
    /// migration to any database. Supervisor reviews this PR before
    /// it ships to any environment.
    /// </para>
    /// </remarks>
    /// </summary>
    public partial class AddGoldenSetCandidateTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "golden_set_candidate",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    audio_content_hash = table.Column<string>(type: "char(64)", maxLength: 64, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bucket_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    correction_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ai_suggested_json = table.Column<string>(type: "jsonb", nullable: false),
                    farmer_corrected_json = table.Column<string>(type: "jsonb", nullable: false),
                    transcript_codemix = table.Column<string>(type: "text", nullable: true),
                    transcript_verbatim = table.Column<string>(type: "text", nullable: true),
                    prompt_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    extractor_code_sha = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    promoted_to_golden_set = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    promoted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_golden_set_candidate", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_golden_set_candidate_audio_correction",
                schema: "ssf",
                table: "golden_set_candidate",
                columns: new[] { "audio_content_hash", "correction_type" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_golden_set_candidate_promoted_created",
                schema: "ssf",
                table: "golden_set_candidate",
                columns: new[] { "promoted_to_golden_set", "created_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_golden_set_candidate_bucket",
                schema: "ssf",
                table: "golden_set_candidate",
                column: "bucket_id");

            migrationBuilder.CreateIndex(
                name: "ix_golden_set_candidate_user",
                schema: "ssf",
                table: "golden_set_candidate",
                column: "user_id");

            // Mirror the existing voice_clips_retained / consent grant
            // pattern: agrisync_app gets SELECT/INSERT/UPDATE/DELETE so
            // both the worker (write) and the future weekly promote
            // job (mutate via Promote()) + the DPDP erasure cascade
            // (delete) can operate. When agrisync_app does not exist
            // (ephemeral test contexts using EnsureCreatedAsync) the
            // grant is skipped without error.
            migrationBuilder.Sql(@"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.golden_set_candidate TO agrisync_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "golden_set_candidate",
                schema: "ssf");
        }
    }
}
