// spec: data-principle-spine-2026-05-05
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 02 sub-phase 02.2. Adds the
    /// <c>ssf.raw_blob_index</c> ref-count table for content-addressed raw
    /// blobs (audio / image / payload bytes) parked in the S3 cold tier.
    /// Sits immediately after W1a's role-bootstrap (<c>20260515090000_BootstrapDbRoles</c>);
    /// new objects therefore inherit the agrisync_app / agrisync_readonly
    /// default privileges that W1a installed on the <c>ssf</c> schema.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Down() is reversible.</b> Mini-spike pattern (mirrors W1a) —
    /// <c>DropTable</c> so local-dev iteration on Phase 02 does not require
    /// a full <c>database drop</c>. Production rollback is still
    /// snapshot-restore per the senior-architect Pre-Flight Brief
    /// (agentId ab6190f1ec1c4bb1d).
    /// </para>
    /// </remarks>
    public partial class AddRawBlobIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "raw_blob_index",
                schema: "ssf",
                columns: table => new
                {
                    sha256 = table.Column<string>(type: "character varying(64)", nullable: false),
                    s3_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    content_type = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    first_seen_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ref_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_raw_blob_index", x => x.sha256);
                });

            migrationBuilder.CreateIndex(
                name: "ix_raw_blob_index_first_seen_utc",
                schema: "ssf",
                table: "raw_blob_index",
                column: "first_seen_utc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "raw_blob_index",
                schema: "ssf");
        }
    }
}
