using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddApplicationInputItemsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "application_input_items",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    operation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    product_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    npk_grade = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    dose_amount = table.Column<decimal>(type: "numeric", nullable: true),
                    dose_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    dose_basis_qty = table.Column<decimal>(type: "numeric", nullable: true),
                    dose_basis_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    ordinal = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_application_input_items", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_application_input_items_operation_id",
                schema: "ssf",
                table: "application_input_items",
                column: "operation_id");

            // ── RLS (ADR 0023 §2 — EXISTS-join child of farm_operations, NULLIF-hardened) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.application_input_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.application_input_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_application_input_items ON ssf.application_input_items;
CREATE POLICY p_tenant_application_input_items ON ssf.application_input_items
  USING (EXISTS (
    SELECT 1 FROM ssf.farm_operations o
    WHERE o.""Id"" = application_input_items.operation_id
      AND o.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (true);

DROP POLICY IF EXISTS p_user_select_application_input_items ON ssf.application_input_items;
CREATE POLICY p_user_select_application_input_items ON ssf.application_input_items
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farm_operations o
    JOIN ssf.farms f ON f.""Id"" = o.farm_id
    WHERE o.""Id"" = application_input_items.operation_id
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
DROP POLICY IF EXISTS p_user_select_application_input_items ON ssf.application_input_items;
DROP POLICY IF EXISTS p_tenant_application_input_items ON ssf.application_input_items;
");

            migrationBuilder.DropTable(
                name: "application_input_items",
                schema: "ssf");
        }
    }
}
