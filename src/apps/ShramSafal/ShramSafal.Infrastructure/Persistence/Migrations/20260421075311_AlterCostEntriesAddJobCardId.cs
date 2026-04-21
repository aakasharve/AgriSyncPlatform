using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AlterCostEntriesAddJobCardId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_cost_entries_job_card_id",
                schema: "ssf",
                table: "cost_entries",
                column: "job_card_id");

            // CEI-I8: partial unique index — at most one labour_payout entry per job card.
            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX idx_cost_entries_job_card_id_labour_payout
                ON ssf.cost_entries (job_card_id)
                WHERE category = 'labour_payout';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ssf.idx_cost_entries_job_card_id_labour_payout;");

            migrationBuilder.DropIndex(
                name: "ix_cost_entries_job_card_id",
                schema: "ssf",
                table: "cost_entries");
        }
    }
}
