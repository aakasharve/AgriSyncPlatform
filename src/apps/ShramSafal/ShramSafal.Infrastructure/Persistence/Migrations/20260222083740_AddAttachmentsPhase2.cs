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
            migrationBuilder.Sql(
"""
CREATE TABLE IF NOT EXISTS ssf.attachments (
    "Id" uuid PRIMARY KEY,
    farm_id uuid NOT NULL,
    linked_entity_id uuid NOT NULL,
    linked_entity_type character varying(80) NOT NULL,
    file_name character varying(255) NOT NULL,
    mime_type character varying(120) NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at_utc timestamp with time zone NOT NULL,
    modified_at_utc timestamp with time zone NOT NULL,
    status character varying(30) NOT NULL,
    local_path character varying(1000) NULL,
    size_bytes bigint NULL,
    uploaded_at_utc timestamp with time zone NULL,
    finalized_at_utc timestamp with time zone NULL
);

CREATE INDEX IF NOT EXISTS ix_attachments_farm_id_created_at_utc
    ON ssf.attachments (farm_id, created_at_utc);

CREATE INDEX IF NOT EXISTS ix_attachments_linked_entity_type_linked_entity_id
    ON ssf.attachments (linked_entity_type, linked_entity_id);

CREATE INDEX IF NOT EXISTS ix_attachments_modified_at_utc
    ON ssf.attachments (modified_at_utc);
""");
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
