// spec: dfes-input-truth-and-mix-check-2026-11-06 - lane IT1c (decisions D-107 B and D-108 3): the product library on the
// server, and the source intake that checks a new source against what is already in.
using System;
using Microsoft.EntityFrameworkCore.Migrations;
using ShramSafal.Infrastructure.Persistence.InputLibrary;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// lane IT1c - the input library on the server: five ShramSafal-wide reference tables (<c>input_library_sources</c>,
    /// <c>input_library_products</c>, <c>input_library_source_refs</c>, <c>input_library_conflicts</c>,
    /// <c>input_library_meta</c>). None has a farm column: every farm reads the same library.
    ///
    /// <para><b>The seed (source 1).</b> The founder's dosage guide reaches the database from the <c>catalog.json</c> the build
    /// embeds, read by C# code (<see cref="InputLibrarySeedSql"/>) when this migration runs: 1 source, 297 published products,
    /// their source refs and the library's meta row (published version 1). No data is written into this file. Every seed
    /// statement ends in <c>ON CONFLICT DO NOTHING</c>, so it adds nothing over rows that are already there. A fresh database
    /// seeds whatever <c>catalog.json</c> holds when it is migrated; a database already migrated keeps what it was given and
    /// changes only through the intake command, never by a later edit of the file.</para>
    ///
    /// <para><b>Row-level security: the <c>cost_categories</c> shape, on every table</b>
    /// (<c>20260516130000_EnableRowLevelSecurity</c>, step 8). ENABLE + FORCE, <c>p_global_{t}_read FOR SELECT USING (true)</c>
    /// so every scope (a farm's, a user's, none) can read, and <c>p_global_{t}_deny_write FOR ALL TO agrisync_app USING (false)
    /// WITH CHECK (false)</c> so the app role can never insert, update or delete. The library is written only through the
    /// admin connection (the intake command), never through <c>agrisync_app</c>. The policies are created AFTER the seed, as the
    /// seed is written by the schema runner while the app role is not yet denied.</para>
    ///
    /// <para><b>The read grant.</b> An explicit <c>GRANT SELECT</c> on the five tables to <c>agrisync_app</c>, idempotent and
    /// role-guarded in the style of <c>20260713052440_AddDfesDataSpine</c>, so reads never depend on default privileges. It grants
    /// SELECT only and revokes nothing; with FORCE RLS the deny-write policy above still blocks every write of that role, so the
    /// grant does not weaken it.</para>
    ///
    /// <para><b>Behaviour.</b> Additive: five new tables, their policies and a SELECT grant on them. No existing table, column,
    /// policy, grant or row is touched; nothing reads the tables until the route and the intake exist. The deployed 1.0.17
    /// phones are unaffected.</para>
    ///
    /// <para><b>Down() destroys the library's rows</b>, stated before it ever runs: it drops the five tables with their
    /// policies, grants, indexes and constraints, so the seeded source 1 and anything the intake command added (sources, products,
    /// refs, conflicts and rulings) are gone. The embedded <c>catalog.json</c> still serves as the phones' and the server's
    /// fallback. Re-running Up() re-seeds source 1 only. It never touches <c>ssf.audit_events</c>, its policies or any grant on
    /// another table.</para>
    /// </summary>
    public partial class AddInputLibrary : Migration
    {
        internal const string SecuritySql = @"
-- ssf.input_library_*: ShramSafal-wide reference data. Readable by every scope; never writable by agrisync_app.
ALTER TABLE ssf.input_library_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.input_library_sources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_global_input_library_sources_read ON ssf.input_library_sources;
CREATE POLICY p_global_input_library_sources_read ON ssf.input_library_sources
  FOR SELECT USING (true);
DROP POLICY IF EXISTS p_global_input_library_sources_deny_write ON ssf.input_library_sources;
CREATE POLICY p_global_input_library_sources_deny_write ON ssf.input_library_sources
  FOR ALL TO agrisync_app
  USING (false)
  WITH CHECK (false);

ALTER TABLE ssf.input_library_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.input_library_products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_global_input_library_products_read ON ssf.input_library_products;
CREATE POLICY p_global_input_library_products_read ON ssf.input_library_products
  FOR SELECT USING (true);
DROP POLICY IF EXISTS p_global_input_library_products_deny_write ON ssf.input_library_products;
CREATE POLICY p_global_input_library_products_deny_write ON ssf.input_library_products
  FOR ALL TO agrisync_app
  USING (false)
  WITH CHECK (false);

ALTER TABLE ssf.input_library_source_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.input_library_source_refs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_global_input_library_source_refs_read ON ssf.input_library_source_refs;
CREATE POLICY p_global_input_library_source_refs_read ON ssf.input_library_source_refs
  FOR SELECT USING (true);
DROP POLICY IF EXISTS p_global_input_library_source_refs_deny_write ON ssf.input_library_source_refs;
CREATE POLICY p_global_input_library_source_refs_deny_write ON ssf.input_library_source_refs
  FOR ALL TO agrisync_app
  USING (false)
  WITH CHECK (false);

ALTER TABLE ssf.input_library_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.input_library_conflicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_global_input_library_conflicts_read ON ssf.input_library_conflicts;
CREATE POLICY p_global_input_library_conflicts_read ON ssf.input_library_conflicts
  FOR SELECT USING (true);
DROP POLICY IF EXISTS p_global_input_library_conflicts_deny_write ON ssf.input_library_conflicts;
CREATE POLICY p_global_input_library_conflicts_deny_write ON ssf.input_library_conflicts
  FOR ALL TO agrisync_app
  USING (false)
  WITH CHECK (false);

ALTER TABLE ssf.input_library_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.input_library_meta FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_global_input_library_meta_read ON ssf.input_library_meta;
CREATE POLICY p_global_input_library_meta_read ON ssf.input_library_meta
  FOR SELECT USING (true);
DROP POLICY IF EXISTS p_global_input_library_meta_deny_write ON ssf.input_library_meta;
CREATE POLICY p_global_input_library_meta_deny_write ON ssf.input_library_meta
  FOR ALL TO agrisync_app
  USING (false)
  WITH CHECK (false);

-- ── Explicit read grant, so reads never depend on default privileges ──
-- SELECT only, and nothing is revoked: the deny-write policies above (FORCE RLS) still block every write of agrisync_app,
-- so this grant does not weaken them. Same style as 20260713052440_AddDfesDataSpine: idempotent (GRANT is) and role-guarded,
-- so a database where the roles were never bootstrapped (some test harnesses) skips instead of failing.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT ON ssf.input_library_sources TO agrisync_app;
        GRANT SELECT ON ssf.input_library_products TO agrisync_app;
        GRANT SELECT ON ssf.input_library_source_refs TO agrisync_app;
        GRANT SELECT ON ssf.input_library_conflicts TO agrisync_app;
        GRANT SELECT ON ssf.input_library_meta TO agrisync_app;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "input_library_meta",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false),
                    shape_version = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    published_version = table.Column<int>(type: "integer", nullable: false),
                    non_matching_words = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_input_library_meta", x => x.id);
                    table.CheckConstraint("ck_input_library_meta_single_row", "id = 1");
                });

            migrationBuilder.CreateTable(
                name: "input_library_products",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    category = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    facts = table.Column<string>(type: "jsonb", nullable: false),
                    match_key = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    ordinal = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_input_library_products", x => x.id);
                    table.CheckConstraint("ck_input_library_products_status", "status IN ('draft','published')");
                });

            migrationBuilder.CreateTable(
                name: "input_library_sources",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    received_on = table.Column<DateOnly>(type: "date", nullable: false),
                    checked_by = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_input_library_sources", x => x.id);
                    table.CheckConstraint("ck_input_library_sources_kind", "kind IN ('guide','company-list','university','label')");
                    table.CheckConstraint("ck_input_library_sources_status", "status IN ('draft','published')");
                });

            migrationBuilder.CreateTable(
                name: "input_library_conflicts",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    field = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    existing_value = table.Column<string>(type: "jsonb", nullable: false),
                    incoming_source_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    incoming_ref = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    incoming_value = table.Column<string>(type: "jsonb", nullable: false),
                    incoming_product_id = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    decided_by = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    decided_on = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_input_library_conflicts", x => x.id);
                    table.CheckConstraint("ck_input_library_conflicts_status", "status IN ('open','real_difference','error')");
                    table.ForeignKey(
                        name: "FK_input_library_conflicts_input_library_products_product_id",
                        column: x => x.product_id,
                        principalSchema: "ssf",
                        principalTable: "input_library_products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_input_library_conflicts_input_library_sources_incoming_sour~",
                        column: x => x.incoming_source_id,
                        principalSchema: "ssf",
                        principalTable: "input_library_sources",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "input_library_source_refs",
                schema: "ssf",
                columns: table => new
                {
                    product_id = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    source_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    @ref = table.Column<string>(name: "ref", type: "character varying(120)", maxLength: 120, nullable: false),
                    entry = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_input_library_source_refs", x => new { x.product_id, x.source_id, x.@ref });
                    table.ForeignKey(
                        name: "FK_input_library_source_refs_input_library_products_product_id",
                        column: x => x.product_id,
                        principalSchema: "ssf",
                        principalTable: "input_library_products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_input_library_source_refs_input_library_sources_source_id",
                        column: x => x.source_id,
                        principalSchema: "ssf",
                        principalTable: "input_library_sources",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_input_library_conflicts_incoming_source_id",
                schema: "ssf",
                table: "input_library_conflicts",
                column: "incoming_source_id");

            migrationBuilder.CreateIndex(
                name: "ix_input_library_conflicts_status",
                schema: "ssf",
                table: "input_library_conflicts",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ux_input_library_conflicts_product_field_source",
                schema: "ssf",
                table: "input_library_conflicts",
                columns: new[] { "product_id", "field", "incoming_source_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_input_library_products_match_key",
                schema: "ssf",
                table: "input_library_products",
                column: "match_key");

            migrationBuilder.CreateIndex(
                name: "ix_input_library_products_status",
                schema: "ssf",
                table: "input_library_products",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_input_library_source_refs_source_id",
                schema: "ssf",
                table: "input_library_source_refs",
                column: "source_id");

            // Source 1: the founder's dosage guide, from the catalog.json the build embeds (read in C#, never a SQL literal in
            // this file). Idempotent (ON CONFLICT DO NOTHING). Written BEFORE the policies below deny the app role.
            foreach (var statement in InputLibrarySeedSql.ForEmbeddedSeed())
            {
                migrationBuilder.Sql(statement);
            }

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "input_library_conflicts",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "input_library_meta",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "input_library_source_refs",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "input_library_products",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "input_library_sources",
                schema: "ssf");
        }
    }
}
