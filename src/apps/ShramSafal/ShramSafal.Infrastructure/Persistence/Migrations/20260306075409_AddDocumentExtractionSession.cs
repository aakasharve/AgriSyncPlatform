using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDocumentExtractionSession : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "document_extraction_sessions",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    draft_result_json = table.Column<string>(type: "text", nullable: true),
                    verified_result_json = table.Column<string>(type: "text", nullable: true),
                    draft_confidence = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    verified_confidence = table.Column<decimal>(type: "numeric(5,4)", nullable: true),
                    draft_provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    verification_provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    draft_ai_job_id = table.Column<Guid>(type: "uuid", nullable: true),
                    verification_ai_job_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_document_extraction_sessions", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_document_extraction_sessions_farm_id_status",
                schema: "ssf",
                table: "document_extraction_sessions",
                columns: new[] { "farm_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_document_extraction_sessions_user_id_created_at_utc",
                schema: "ssf",
                table: "document_extraction_sessions",
                columns: new[] { "user_id", "created_at_utc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "document_extraction_sessions",
                schema: "ssf");
        }
    }
}
