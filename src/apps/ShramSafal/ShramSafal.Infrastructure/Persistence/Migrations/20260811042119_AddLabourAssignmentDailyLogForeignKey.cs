using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLabourAssignmentDailyLogForeignKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddForeignKey(
                name: "FK_labour_assignments_daily_logs_daily_log_id",
                schema: "ssf",
                table: "labour_assignments",
                column: "daily_log_id",
                principalSchema: "ssf",
                principalTable: "daily_logs",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_labour_assignments_daily_logs_daily_log_id",
                schema: "ssf",
                table: "labour_assignments");
        }
    }
}
