using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLogTaskComplianceColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "compliance_delta_days",
                schema: "ssf",
                table: "log_tasks",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "compliance_matched_task_id",
                schema: "ssf",
                table: "log_tasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "compliance_outcome",
                schema: "ssf",
                table: "log_tasks",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "compliance_subscription_id",
                schema: "ssf",
                table: "log_tasks",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "compliance_delta_days",
                schema: "ssf",
                table: "log_tasks");

            migrationBuilder.DropColumn(
                name: "compliance_matched_task_id",
                schema: "ssf",
                table: "log_tasks");

            migrationBuilder.DropColumn(
                name: "compliance_outcome",
                schema: "ssf",
                table: "log_tasks");

            migrationBuilder.DropColumn(
                name: "compliance_subscription_id",
                schema: "ssf",
                table: "log_tasks");
        }
    }
}
