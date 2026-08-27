using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLabourCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "labour_corrections",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    labour_assignment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    changed_field = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    original_value = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    new_value = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    reason = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    corrected_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    corrected_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_labour_corrections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_labour_corrections_farms_farm_id",
                        column: x => x.farm_id,
                        principalSchema: "ssf",
                        principalTable: "farms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_labour_corrections_labour_assignments_labour_assignment_id",
                        column: x => x.labour_assignment_id,
                        principalSchema: "ssf",
                        principalTable: "labour_assignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_labour_corrections_assignment_corrected_at",
                schema: "ssf",
                table: "labour_corrections",
                columns: new[] { "labour_assignment_id", "corrected_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_labour_corrections_farm_id",
                schema: "ssf",
                table: "labour_corrections",
                column: "farm_id");

            // ── RLS (spec: 2026-07-13-labour-attendance-approval-design, Labour
            // V1 Task 12b — the SAME direct-farm_id block Tasks 9 and 10 used on
            // ssf.field_operators / ssf.field_operator_work_rows, NULLIF-hardened
            // from day one).
            //
            // The WITH CHECK is the DIRECT column comparison, NEVER an
            // EXISTS-join: an EXISTS-based WITH CHECK on a child table caused a
            // proven 42501 on INSERT and was reverted in 20260703210908. The
            // direct farm_id column on this table is precisely what makes the
            // simple form available.
            //
            // APPEND-ONLY is carried by the CODE, not by a policy split: there
            // is no update path and no delete path anywhere — no Modify/Delete on
            // the entity, no repository member, no route. A FOR UPDATE/FOR DELETE
            // policy would imply those paths exist and are merely gated. ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.labour_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.labour_corrections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_labour_corrections ON ssf.labour_corrections;
CREATE POLICY p_tenant_labour_corrections ON ssf.labour_corrections
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DROP POLICY IF EXISTS p_user_select_labour_corrections ON ssf.labour_corrections;
CREATE POLICY p_user_select_labour_corrections ON ssf.labour_corrections
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = labour_corrections.farm_id
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
DROP POLICY IF EXISTS p_user_select_labour_corrections ON ssf.labour_corrections;
DROP POLICY IF EXISTS p_tenant_labour_corrections ON ssf.labour_corrections;
");

            migrationBuilder.DropTable(
                name: "labour_corrections",
                schema: "ssf");
        }
    }
}
