using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDisturbanceStructuredFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "affected_scope",
                schema: "ssf",
                table: "disturbance_events",
                type: "character varying(15)",
                maxLength: 15,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "cause",
                schema: "ssf",
                table: "disturbance_events",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "impact",
                schema: "ssf",
                table: "disturbance_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "resolved_status",
                schema: "ssf",
                table: "disturbance_events",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "affected_scope",
                schema: "ssf",
                table: "disturbance_events");

            migrationBuilder.DropColumn(
                name: "cause",
                schema: "ssf",
                table: "disturbance_events");

            migrationBuilder.DropColumn(
                name: "impact",
                schema: "ssf",
                table: "disturbance_events");

            migrationBuilder.DropColumn(
                name: "resolved_status",
                schema: "ssf",
                table: "disturbance_events");
        }
    }
}
