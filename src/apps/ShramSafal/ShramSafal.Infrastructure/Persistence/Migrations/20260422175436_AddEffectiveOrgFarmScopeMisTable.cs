using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEffectiveOrgFarmScopeMisTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // mis.effective_org_farm_scope is a projection table owned by
            // OrgFarmScopeProjector (Phase 5) — NOT mapped to a DbSet.
            // Every MIS query that filters by scope JOINs this table.
            // Platform org special-cases one row with farm_id = Guid.Empty
            // and source = 'PlatformWildcard' to avoid row-per-farm explosion.
            migrationBuilder.Sql(@"
CREATE SCHEMA IF NOT EXISTS mis;

CREATE TABLE IF NOT EXISTS mis.effective_org_farm_scope (
    org_id uuid NOT NULL,
    farm_id uuid NOT NULL,
    source text NOT NULL,
    refreshed_at_utc timestamptz NOT NULL,
    PRIMARY KEY (org_id, farm_id)
);

CREATE INDEX IF NOT EXISTS ix_eofs_farm ON mis.effective_org_farm_scope(farm_id);
CREATE INDEX IF NOT EXISTS ix_eofs_org  ON mis.effective_org_farm_scope(org_id);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP TABLE IF EXISTS mis.effective_org_farm_scope;
");
        }
    }
}
