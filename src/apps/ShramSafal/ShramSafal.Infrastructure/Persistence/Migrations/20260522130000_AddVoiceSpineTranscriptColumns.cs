using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddVoiceSpineTranscriptColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "diarized_transcript_json",
                schema: "ssf",
                table: "ai_jobs",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "ai_jobs",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "referenced_date",
                schema: "ssf",
                table: "ai_jobs",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "referenced_date_confidence",
                schema: "ssf",
                table: "ai_jobs",
                type: "numeric(5,4)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "referenced_date_reason",
                schema: "ssf",
                table: "ai_jobs",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "transcribed_at_utc",
                schema: "ssf",
                table: "ai_jobs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcript_codemix",
                schema: "ssf",
                table: "ai_jobs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcript_english",
                schema: "ssf",
                table: "ai_jobs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcript_english_redacted",
                schema: "ssf",
                table: "ai_jobs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcript_model_version",
                schema: "ssf",
                table: "ai_jobs",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcript_provider",
                schema: "ssf",
                table: "ai_jobs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcript_schema_version",
                schema: "ssf",
                table: "ai_jobs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "v1.0");

            migrationBuilder.AddColumn<string>(
                name: "transcript_translate",
                schema: "ssf",
                table: "ai_jobs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcript_translit",
                schema: "ssf",
                table: "ai_jobs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcript_verbatim",
                schema: "ssf",
                table: "ai_jobs",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "diarized_transcript_json",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "extractor_code_sha",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "referenced_date",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "referenced_date_confidence",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "referenced_date_reason",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcribed_at_utc",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_codemix",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_english",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_english_redacted",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_model_version",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_provider",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_schema_version",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_translate",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_translit",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "transcript_verbatim",
                schema: "ssf",
                table: "ai_jobs");
        }
    }
}
