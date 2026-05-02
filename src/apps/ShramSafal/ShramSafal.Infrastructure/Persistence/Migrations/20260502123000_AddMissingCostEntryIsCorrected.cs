using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration("20260502123000_AddMissingCostEntryIsCorrected")]
    public partial class AddMissingCostEntryIsCorrected : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS is_corrected boolean NOT NULL DEFAULT FALSE;
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Previous model snapshots already require this column. Dropping it
            // would recreate the schema drift this corrective migration fixes.
        }
    }
}
