using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEventLinksTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_links",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    to_farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_operation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    to_operation_id = table.Column<Guid>(type: "uuid", nullable: true),
                    to_cost_entry_id = table.Column<Guid>(type: "uuid", nullable: true),
                    link_kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_links", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_event_links_from_operation_id",
                schema: "ssf",
                table: "event_links",
                column: "from_operation_id");

            // ── DB CHECKs (D-T3-Q1 Design C: XOR target + same-farm guard) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.event_links ADD CONSTRAINT ck_event_links_one_target
  CHECK ((to_operation_id IS NULL) <> (to_cost_entry_id IS NULL));
ALTER TABLE ssf.event_links ADD CONSTRAINT ck_event_links_same_farm
  CHECK (from_farm_id = to_farm_id);
");
            // ── RLS (ADR 0023 §2 — EXISTS-join to farm_operations via from_operation_id, NULLIF) ──
            migrationBuilder.Sql(@"
ALTER TABLE ssf.event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.event_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_event_links ON ssf.event_links;
CREATE POLICY p_tenant_event_links ON ssf.event_links
  USING (EXISTS (
    SELECT 1 FROM ssf.farm_operations o
    WHERE o.""Id"" = event_links.from_operation_id
      AND o.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (true);

DROP POLICY IF EXISTS p_user_select_event_links ON ssf.event_links;
CREATE POLICY p_user_select_event_links ON ssf.event_links
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farm_operations o
    JOIN ssf.farms f ON f.""Id"" = o.farm_id
    WHERE o.""Id"" = event_links.from_operation_id
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
DROP POLICY IF EXISTS p_user_select_event_links ON ssf.event_links;
DROP POLICY IF EXISTS p_tenant_event_links ON ssf.event_links;
");

            migrationBuilder.DropTable(
                name: "event_links",
                schema: "ssf");
        }
    }
}
