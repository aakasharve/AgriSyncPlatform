using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLabourAssignmentShiftTaskNames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "shift",
                schema: "ssf",
                table: "labour_assignments",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "task",
                schema: "ssf",
                table: "labour_assignments",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "worker_names_json",
                schema: "ssf",
                table: "labour_assignments",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'[]'::jsonb");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "shift",
                schema: "ssf",
                table: "labour_assignments");

            migrationBuilder.DropColumn(
                name: "task",
                schema: "ssf",
                table: "labour_assignments");

            migrationBuilder.DropColumn(
                name: "worker_names_json",
                schema: "ssf",
                table: "labour_assignments");
        }
    }
}
