// spec: data-principle-spine-2026-05-05
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 02 sub-phase 02.3. Adds the
    /// <c>ssf.transcripts</c> warm-tier projection — one row per
    /// <c>AiJobAttempt</c> (unique index on <c>ai_job_attempt_id</c>),
    /// with <c>jsonb</c> per-token confidence stored as <c>"[]"</c> until
    /// the Phase 03 scorer lands.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Down() is reversible.</b> Mirrors the 02.2 pattern
    /// (<c>20260515100000_AddRawBlobIndex</c>) so local-dev iteration on
    /// Phase 02 does not require a full <c>database drop</c>. Production
    /// rollback is still snapshot-restore per the senior-architect
    /// Pre-Flight Brief.
    /// </para>
    /// </remarks>
    public partial class AddTranscripts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "transcripts",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    ai_job_id = table.Column<Guid>(type: "uuid", nullable: false),
                    ai_job_attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    language_tag = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    per_token_confidence = table.Column<string>(type: "jsonb", nullable: false),
                    produced_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_transcripts", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_transcripts_ai_job_id",
                schema: "ssf",
                table: "transcripts",
                column: "ai_job_id");

            migrationBuilder.CreateIndex(
                name: "ux_transcripts_ai_job_attempt_id",
                schema: "ssf",
                table: "transcripts",
                column: "ai_job_attempt_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "transcripts",
                schema: "ssf");
        }
    }
}
