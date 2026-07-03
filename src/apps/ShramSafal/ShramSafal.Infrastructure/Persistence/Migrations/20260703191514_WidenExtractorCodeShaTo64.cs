using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// ai-intelligence-plan-2026-06-25 W1.P2 T3 — widen
    /// <c>extractor_code_sha</c> from <c>varchar(40)</c> to <c>varchar(64)</c>
    /// on every Provenance-owning / extractor-carrying table.
    /// </summary>
    /// <remarks>
    /// The orchestrator now stamps <c>Provenance.ExtractorCodeSha</c> with the
    /// 64-char SHA-256 prompt content hash
    /// (<c>AiPromptTemplateRegistry.CurrentVoicePromptContentHash</c>). At
    /// width 40 every real voice-parse AiJob INSERT fails with Npgsql 22001
    /// (value too long). This migration is <b>AlterColumn only</b> — widening
    /// is non-destructive (existing ≤40-char values fit), so it is safe on a
    /// prod deploy. Tables widened (7): <c>ai_jobs</c>, <c>ai_job_attempts</c>,
    /// <c>cost_entries</c>, <c>daily_logs</c>, <c>farm_operations</c>,
    /// <c>golden_set_candidate</c>, <c>transcript_history</c>. Down() reverts
    /// each to <c>varchar(40)</c>.
    /// </remarks>
    public partial class WidenExtractorCodeShaTo64 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "transcript_history",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "golden_set_candidate",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "farm_operations",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "ai_jobs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "ai_job_attempts",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "transcript_history",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "golden_set_candidate",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "farm_operations",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "ai_jobs",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "ai_job_attempts",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);
        }
    }
}
