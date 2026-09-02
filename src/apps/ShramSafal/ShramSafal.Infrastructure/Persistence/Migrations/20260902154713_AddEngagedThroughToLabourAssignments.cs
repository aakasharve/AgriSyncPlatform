using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEngagedThroughToLabourAssignments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "engaged_through_field_operator_id",
                schema: "ssf",
                table: "labour_assignments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_labour_assignments_engaged_through",
                schema: "ssf",
                table: "labour_assignments",
                column: "engaged_through_field_operator_id");

            migrationBuilder.AddForeignKey(
                name: "FK_labour_assignments_field_operators_engaged_through_field_op~",
                schema: "ssf",
                table: "labour_assignments",
                column: "engaged_through_field_operator_id",
                principalSchema: "ssf",
                principalTable: "field_operators",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_labour_assignments_field_operators_engaged_through_field_op~",
                schema: "ssf",
                table: "labour_assignments");

            migrationBuilder.DropIndex(
                name: "ix_labour_assignments_engaged_through",
                schema: "ssf",
                table: "labour_assignments");

            migrationBuilder.DropColumn(
                name: "engaged_through_field_operator_id",
                schema: "ssf",
                table: "labour_assignments");
        }
    }
}
