using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAttendanceMarks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "attendance_marks",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    field_operator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    work_date = table.Column<DateOnly>(type: "date", nullable: false),
                    day_mark = table.Column<int>(type: "integer", nullable: false),
                    night_mark = table.Column<int>(type: "integer", nullable: false),
                    hours_worked = table.Column<decimal>(type: "numeric(4,1)", nullable: true),
                    extra_hours = table.Column<decimal>(type: "numeric(4,1)", nullable: true),
                    hours_basis = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    recorded_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    recorded_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attendance_marks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_attendance_marks_farm_day",
                schema: "ssf",
                table: "attendance_marks",
                columns: new[] { "farm_id", "work_date" });

            migrationBuilder.CreateIndex(
                name: "ux_attendance_marks_farm_operator_day",
                schema: "ssf",
                table: "attendance_marks",
                columns: new[] { "farm_id", "field_operator_id", "work_date" },
                unique: true);

            // ── RLS, mirroring ssf.field_operator_work_rows exactly. A direct
            // farm_id column on this table is what makes the simple tenant form
            // available. ENABLE alone is not enough: FORCE is what applies the
            // policy to the table owner too. ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.attendance_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.attendance_marks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_attendance_marks ON ssf.attendance_marks;
CREATE POLICY p_tenant_attendance_marks ON ssf.attendance_marks
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DROP POLICY IF EXISTS p_user_select_attendance_marks ON ssf.attendance_marks;
CREATE POLICY p_user_select_attendance_marks ON ssf.attendance_marks
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = attendance_marks.farm_id
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

            // ── GRANTS, and they are not optional. ssf.field_operator_work_rows
            // shipped WITHOUT them and was consequently dead: every read and
            // write died with 42501 for its entire life, unnoticed, because
            // nothing read it either. Fixed separately in 92e3d0e6. A new table
            // gets its grants in the same migration that creates it. ──
            migrationBuilder.Sql(@"
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.attendance_marks TO agrisync_app;
            END IF;

            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
                GRANT SELECT ON ssf.attendance_marks TO agrisync_readonly;
            END IF;
        END
        $$;
        ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "attendance_marks",
                schema: "ssf");
        }
    }
}
