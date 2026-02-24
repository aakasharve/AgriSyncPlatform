using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAiVoiceMetadataFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
"""
ALTER TABLE ssf.ai_jobs
    ADD COLUMN IF NOT EXISTS input_session_metadata_json jsonb;

ALTER TABLE ssf.ai_job_attempts
    ADD COLUMN IF NOT EXISTS request_payload_hash character varying(128);
""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "input_session_metadata_json",
                schema: "ssf",
                table: "ai_jobs");

            migrationBuilder.DropColumn(
                name: "request_payload_hash",
                schema: "ssf",
                table: "ai_job_attempts");
        }
    }
}
