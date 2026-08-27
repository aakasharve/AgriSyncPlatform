using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFieldOperatorWorkRows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "field_operator_work_rows",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    field_operator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    labour_assignment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    work_date = table.Column<DateOnly>(type: "date", nullable: false),
                    display_name_at_attach = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    recorded_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_field_operator_work_rows", x => x.Id);
                    table.ForeignKey(
                        name: "FK_field_operator_work_rows_farms_farm_id",
                        column: x => x.farm_id,
                        principalSchema: "ssf",
                        principalTable: "farms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_field_operator_work_rows_field_operators_field_operator_id",
                        column: x => x.field_operator_id,
                        principalSchema: "ssf",
                        principalTable: "field_operators",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_field_operator_work_rows_labour_assignments_labour_assignme~",
                        column: x => x.labour_assignment_id,
                        principalSchema: "ssf",
                        principalTable: "labour_assignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_field_operator_work_rows_farm_id",
                schema: "ssf",
                table: "field_operator_work_rows",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "IX_field_operator_work_rows_labour_assignment_id",
                schema: "ssf",
                table: "field_operator_work_rows",
                column: "labour_assignment_id");

            migrationBuilder.CreateIndex(
                name: "ux_field_operator_work_rows_operator_assignment",
                schema: "ssf",
                table: "field_operator_work_rows",
                columns: new[] { "field_operator_id", "labour_assignment_id" },
                unique: true);

            // ── RLS (spec: 2026-07-13-labour-attendance-approval-design, Labour
            // V1 Task 10 — DIRECT farm_id, NULLIF-hardened from day one, the
            // same block Task 9 used on ssf.field_operators).
            //
            // The WITH CHECK is the DIRECT column comparison, never an
            // EXISTS-join: an EXISTS-based WITH CHECK on a child table caused a
            // proven 42501 on INSERT and was reverted in 20260703210908. The
            // direct farm_id column on this table is precisely what makes the
            // simple form available. ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.field_operator_work_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.field_operator_work_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_field_operator_work_rows ON ssf.field_operator_work_rows;
CREATE POLICY p_tenant_field_operator_work_rows ON ssf.field_operator_work_rows
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DROP POLICY IF EXISTS p_user_select_field_operator_work_rows ON ssf.field_operator_work_rows;
CREATE POLICY p_user_select_field_operator_work_rows ON ssf.field_operator_work_rows
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = field_operator_work_rows.farm_id
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
DROP POLICY IF EXISTS p_user_select_field_operator_work_rows ON ssf.field_operator_work_rows;
DROP POLICY IF EXISTS p_tenant_field_operator_work_rows ON ssf.field_operator_work_rows;
");

            migrationBuilder.DropTable(
                name: "field_operator_work_rows",
                schema: "ssf");
        }
    }
}
