using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRoutinePatternsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "routine_patterns",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    operation_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    typical_duration_hours = table.Column<decimal>(type: "numeric", nullable: true),
                    typical_method = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    typical_source = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    sample_count = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_routine_patterns", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_routine_patterns_farm_id",
                schema: "ssf",
                table: "routine_patterns",
                column: "farm_id");

            // ── RLS (ADR 0023 §2 — DIRECT farm_id, NULLIF-hardened from day one) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.routine_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.routine_patterns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_routine_patterns ON ssf.routine_patterns;
CREATE POLICY p_tenant_routine_patterns ON ssf.routine_patterns
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DROP POLICY IF EXISTS p_user_select_routine_patterns ON ssf.routine_patterns;
CREATE POLICY p_user_select_routine_patterns ON ssf.routine_patterns
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = routine_patterns.farm_id
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_routine_patterns ON ssf.routine_patterns;
DROP POLICY IF EXISTS p_tenant_routine_patterns ON ssf.routine_patterns;
");

            migrationBuilder.DropTable(
                name: "routine_patterns",
                schema: "ssf");
        }
    }
}
