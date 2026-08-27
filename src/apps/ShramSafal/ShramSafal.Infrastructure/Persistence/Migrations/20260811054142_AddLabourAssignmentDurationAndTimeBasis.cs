using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLabourAssignmentDurationAndTimeBasis : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Hand-edited (Task 4, spec 2026-07-13-labour-attendance-approval-design):
            // add both columns NOT NULL WITH a default, then immediately drop the
            // default. The table has 0 rows today, so this backfills nothing — but it
            // guarantees no FUTURE insert can silently inherit a fabricated duration by
            // omitting the column. Every row from here on must state its own time.
            migrationBuilder.Sql(@"
                ALTER TABLE ssf.labour_assignments
                    ADD COLUMN duration_hours numeric     NOT NULL DEFAULT 8,
                    ADD COLUMN time_basis     varchar(12) NOT NULL DEFAULT 'Assumed';
                ALTER TABLE ssf.labour_assignments
                    ALTER COLUMN duration_hours DROP DEFAULT,
                    ALTER COLUMN time_basis     DROP DEFAULT;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "duration_hours",
                schema: "ssf",
                table: "labour_assignments");

            migrationBuilder.DropColumn(
                name: "time_basis",
                schema: "ssf",
                table: "labour_assignments");
        }
    }
}
