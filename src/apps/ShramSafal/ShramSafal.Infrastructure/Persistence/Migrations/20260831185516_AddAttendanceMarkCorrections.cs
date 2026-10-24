using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAttendanceMarkCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "attendance_mark_corrections",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendance_mark_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    changed_field = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    original_value = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    new_value = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    corrected_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    corrected_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attendance_mark_corrections", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_attendance_mark_corrections_farm",
                schema: "ssf",
                table: "attendance_mark_corrections",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_attendance_mark_corrections_mark_time",
                schema: "ssf",
                table: "attendance_mark_corrections",
                columns: new[] { "attendance_mark_id", "corrected_at_utc" });

            // RLS: tenant policy, ENABLED and FORCED (like ssf.attendance_marks —
            // but deliberately WITHOUT its user-select policy: corrections are not
            // pulled user-scoped in R1). Enable alone
            // leaves the table owner outside the policy.
            migrationBuilder.Sql(@"
ALTER TABLE ssf.attendance_mark_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.attendance_mark_corrections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_attendance_mark_corrections ON ssf.attendance_mark_corrections;
CREATE POLICY p_tenant_attendance_mark_corrections ON ssf.attendance_mark_corrections
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
");

            // APPEND-ONLY, ENFORCED BY THE GRANT rather than by convention:
            // SELECT and INSERT, never UPDATE or DELETE. This table answers "what
            // did it say before", and a history that can itself be edited answers
            // nothing at all.
            //
            // Grants ship in the CREATING migration. ssf.field_operator_work_rows
            // shipped without them and was dead for its entire life — every read
            // and write 42501, unnoticed, because nothing read it either (fixed
            // separately in 92e3d0e6).
            migrationBuilder.Sql(@"
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
                GRANT SELECT, INSERT ON ssf.attendance_mark_corrections TO agrisync_app;
            END IF;

            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
                GRANT SELECT ON ssf.attendance_mark_corrections TO agrisync_readonly;
            END IF;
        END
        $$;
        ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "attendance_mark_corrections",
                schema: "ssf");
        }
    }
}
