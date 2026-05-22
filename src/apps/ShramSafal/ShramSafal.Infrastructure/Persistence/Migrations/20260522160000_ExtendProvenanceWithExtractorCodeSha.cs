using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.7 — extend the
    /// Provenance owned record with a sixth field, <c>extractor_code_sha</c>.
    /// Phase 1.1 added the column to <c>ssf.ai_jobs</c> as a top-level AiJob
    /// property; Task 1.7 resolves the doctrine conflict by moving ownership
    /// to the shared <c>Provenance</c> record (ADR-DS-014 §E). The physical
    /// column on <c>ai_jobs</c> stays in place — this migration only fills
    /// the gap on the other three Provenance-owning tables so every owner
    /// carries the column uniformly.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Timestamp.</b> EF generated <c>20260522070345</c>; manually renamed
    /// to <c>20260522160000</c> so the natural chronological order in EF's
    /// history matches the apply order (Phase 1.5's auxiliary-tables
    /// migration is <c>20260522150000</c>).
    /// </para>
    /// <para>
    /// <b>Tables altered.</b>
    /// <list type="bullet">
    ///   <item><c>ssf.ai_job_attempts</c> — adds <c>extractor_code_sha varchar(40) NULL</c></item>
    ///   <item><c>ssf.daily_logs</c> — adds <c>extractor_code_sha varchar(40) NULL</c></item>
    ///   <item><c>ssf.cost_entries</c> — adds <c>extractor_code_sha varchar(40) NULL</c></item>
    /// </list>
    /// </para>
    /// <para>
    /// <b>No DROP on ai_jobs.</b> The column added in Phase 1.1
    /// (<c>20260522130000_AddVoiceSpineTranscriptColumns</c>) is preserved
    /// verbatim — only the EF ownership moved from the top-level AiJob
    /// property to the OwnsOne'd Provenance navigation. EF correctly emitted
    /// zero <c>DropColumn</c> calls for <c>ai_jobs</c>.
    /// </para>
    /// </remarks>
    public partial class ExtendProvenanceWithExtractorCodeSha : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "ai_job_attempts",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "ai_job_attempts");
        }
    }
}
