using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAttachmentsPhase2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "attachments",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    linked_entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    linked_entity_type = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    file_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    mime_type = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    local_path = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    size_bytes = table.Column<long>(type: "bigint", nullable: true),
                    uploaded_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    finalized_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attachments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_attachments_farm_id_created_at_utc",
                schema: "ssf",
                table: "attachments",
                columns: new[] { "farm_id", "created_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_attachments_linked_entity_type_linked_entity_id",
                schema: "ssf",
                table: "attachments",
                columns: new[] { "linked_entity_type", "linked_entity_id" });

            migrationBuilder.CreateIndex(
                name: "IX_attachments_modified_at_utc",
                schema: "ssf",
                table: "attachments",
                column: "modified_at_utc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "attachments",
                schema: "ssf");
        }
    }
}
