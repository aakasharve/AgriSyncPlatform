using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFieldOperators : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "field_operators",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    display_name_normalized = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    full_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    originating_farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_field_operators", x => x.Id);
                    table.ForeignKey(
                        name: "FK_field_operators_farms_originating_farm_id",
                        column: x => x.originating_farm_id,
                        principalSchema: "ssf",
                        principalTable: "farms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_field_operators_originating_farm_id",
                schema: "ssf",
                table: "field_operators",
                column: "originating_farm_id");

            // ── RLS (spec: 2026-07-13-labour-attendance-approval-design, Labour
            // V1 Task 9 — DIRECT originating_farm_id, NULLIF-hardened from day
            // one, copied from 20260630034943_AddRoutinePatternsTable.cs) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.field_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.field_operators FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_field_operators ON ssf.field_operators;
CREATE POLICY p_tenant_field_operators ON ssf.field_operators
  USING      (originating_farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (originating_farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DROP POLICY IF EXISTS p_user_select_field_operators ON ssf.field_operators;
CREATE POLICY p_user_select_field_operators ON ssf.field_operators
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = field_operators.originating_farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status NOT IN (5, 6)
        )
      )
  ));
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_field_operators ON ssf.field_operators;
DROP POLICY IF EXISTS p_tenant_field_operators ON ssf.field_operators;
");

            migrationBuilder.DropTable(
                name: "field_operators",
                schema: "ssf");
        }
    }
}
