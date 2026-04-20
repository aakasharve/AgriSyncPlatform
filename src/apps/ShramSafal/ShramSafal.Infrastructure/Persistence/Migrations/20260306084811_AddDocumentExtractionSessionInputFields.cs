using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDocumentExtractionSessionInputFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "input_image_path",
                schema: "ssf",
                table: "document_extraction_sessions",
                type: "character varying(1024)",
                maxLength: 1024,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "input_mime_type",
                schema: "ssf",
                table: "document_extraction_sessions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "input_image_path",
                schema: "ssf",
                table: "document_extraction_sessions");

            migrationBuilder.DropColumn(
                name: "input_mime_type",
                schema: "ssf",
                table: "document_extraction_sessions");
        }
    }
}
