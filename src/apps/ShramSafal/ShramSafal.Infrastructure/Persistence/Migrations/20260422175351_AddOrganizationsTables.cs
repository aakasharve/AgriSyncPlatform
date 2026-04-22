using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOrganizationsTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "organization_farm_scopes",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source = table.Column<int>(type: "integer", nullable: false),
                    granted_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    granted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organization_farm_scopes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "organization_memberships",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<int>(type: "integer", nullable: false),
                    added_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    joined_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organization_memberships", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "organizations",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    type = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organizations", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_organization_farm_scopes_farm_id",
                schema: "ssf",
                table: "organization_farm_scopes",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "IX_organization_farm_scopes_organization_id",
                schema: "ssf",
                table: "organization_farm_scopes",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "IX_organization_memberships_organization_id",
                schema: "ssf",
                table: "organization_memberships",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "IX_organization_memberships_user_id",
                schema: "ssf",
                table: "organization_memberships",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_organizations_type",
                schema: "ssf",
                table: "organizations",
                column: "type");

            // Partial unique indexes (EF fluent cannot express WHERE). Active-only
            // uniqueness on (org_id, user_id) and (org_id, farm_id) — soft-delete
            // via is_active=false is allowed and must not collide with a new active row.
            migrationBuilder.Sql(@"
CREATE UNIQUE INDEX IF NOT EXISTS ix_org_memberships_active
  ON ssf.organization_memberships (organization_id, user_id)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS ix_org_farm_scopes_active
  ON ssf.organization_farm_scopes (organization_id, farm_id)
  WHERE is_active = true;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP INDEX IF EXISTS ssf.ix_org_memberships_active;
DROP INDEX IF EXISTS ssf.ix_org_farm_scopes_active;
");

            migrationBuilder.DropTable(
                name: "organization_farm_scopes",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "organization_memberships",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "organizations",
                schema: "ssf");
        }
    }
}
