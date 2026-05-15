// spec: data-principle-spine-2026-05-05/02.5
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 02 sub-phase 02.5. Introduces the
    /// server-owned <c>ssf.cost_categories</c> canonical lookup (13 codes per
    /// the Conflict-Resolver R0 verdict, decisions-log 2026-05-15) and migrates
    /// <c>ssf.cost_entries.category</c> (free-text varchar(80)) → <c>category_id</c>
    /// (FK varchar(48) → <c>ssf.cost_categories.id</c>).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Up() is fail-fast and self-contained.</b> Steps:
    /// <list type="alphabet">
    /// <item>A. CreateTable <c>ssf.cost_categories</c>.</item>
    /// <item>B. InsertData the 13 canonical rows (literal seed; the migration
    /// is deliberately decoupled from <c>CostCategorySeed.All</c> at the
    /// type level so renaming or moving the seed class cannot retroactively
    /// alter the historical migration).</item>
    /// <item>C. AddColumn <c>category_id varchar(48) NULL</c> on
    /// <c>ssf.cost_entries</c>.</item>
    /// <item>D. Backfill: deterministic mapping of legacy free-text values to
    /// canonical codes; the labour split keys off <c>job_card_id IS NULL</c>
    /// (verified-payout rows → <c>labour_payout</c>; misc labour rows →
    /// <c>labour_misc</c>).</item>
    /// <item>E. Fail-fast guard: <c>RAISE EXCEPTION</c> if any row still has
    /// <c>category_id IS NULL</c> after the backfill — a future legacy value
    /// that escaped the mapping must be triaged manually before the FK lands.</item>
    /// <item>F. AlterColumn <c>category_id</c> NOT NULL.</item>
    /// <item>G. CreateIndex + AddForeignKey (RESTRICT) on
    /// <c>category_id</c>.</item>
    /// <item>H. DropColumn the legacy <c>category</c> varchar(80) text column.</item>
    /// </list>
    /// </para>
    /// <para>
    /// <b>Down() is reversible.</b> Re-adds <c>category varchar(80) NULL</c>,
    /// backfills from <c>cost_categories.display_en</c> via a join keyed on
    /// the FK code (so a round-trip of Up → Down → Up is loss-less for any
    /// row whose Up-side category mapped to a canonical code; the historical
    /// free-text dies on the H drop and cannot be reconstructed verbatim,
    /// matching the 02.2/02.3 down convention). Then NOT NULL, FK drop,
    /// index drop, column drop, table drop. Production rollback is
    /// snapshot-restore per the Pre-Flight Brief.
    /// </para>
    /// </remarks>
    public partial class AddCostCategoriesLookup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── A. CreateTable ssf.cost_categories ───────────────────
            migrationBuilder.CreateTable(
                name: "cost_categories",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    display_mr = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    display_hi = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    display_en = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cost_categories", x => x.id);
                });

            // ── B. InsertData (canonical 13 rows — Conflict-Resolver R0) ─
            migrationBuilder.InsertData(
                schema: "ssf",
                table: "cost_categories",
                columns: ["id", "display_mr", "display_hi", "display_en", "is_active"],
                values: new object[,]
                {
                    { "labour_payout",  "मजुरी (कामगार पेमेंट)",   "मज़दूरी (कामगार पेमेंट)",  "Labour payout",        true },
                    { "labour_misc",    "इतर मजुरी",                "अन्य मज़दूरी",              "Labour (misc)",        true },
                    { "seeds",          "बियाणे",                   "बीज",                       "Seeds",                true },
                    { "fertilizer",     "खत",                       "उर्वरक",                    "Fertilizer",           true },
                    { "pesticide",      "कीटकनाशक",                 "कीटनाशक",                   "Pesticide",            true },
                    { "irrigation",     "सिंचन",                    "सिंचाई",                    "Irrigation",           true },
                    { "machinery_rent", "मशीन भाडे",                "मशीनरी किराया",             "Machinery rent",       true },
                    { "equipment",      "उपकरण व दुरुस्ती",         "उपकरण व मरम्मत",            "Equipment & repair",   true },
                    { "fuel",           "इंधन (डिझेल/पेट्रोल)",     "ईंधन (डीज़ल/पेट्रोल)",      "Fuel (diesel/petrol)", true },
                    { "transport",      "वाहतूक",                   "परिवहन",                    "Transport",            true },
                    { "electricity",    "वीज",                      "बिजली",                     "Electricity",          true },
                    { "packaging",      "पॅकिंग",                   "पैकेजिंग",                  "Packaging",            true },
                    { "other",          "इतर",                      "अन्य",                      "Other",                true },
                });

            // ── C. AddColumn category_id (NULL while we backfill) ────
            migrationBuilder.AddColumn<string>(
                name: "category_id",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(48)",
                maxLength: 48,
                nullable: true);

            // ── D. Backfill (corrected per Conflict-Resolver R0 verdict) ─
            // Labour split: rows with a JobCardId came from
            // SettleJobCardPayout (verified payouts → `labour_payout`);
            // rows without one are generic labour entries → `labour_misc`.
            migrationBuilder.Sql(@"
UPDATE ssf.cost_entries
SET category_id = CASE
  WHEN lower(category) LIKE '%labour%' AND job_card_id IS NOT NULL THEN 'labour_payout'
  WHEN lower(category) LIKE '%labour%' AND job_card_id IS NULL     THEN 'labour_misc'
  WHEN lower(category) LIKE '%seed%'    OR lower(category) LIKE '%biyane%' THEN 'seeds'
  WHEN lower(category) LIKE '%fert%'    OR lower(category) LIKE '%khat%'   THEN 'fertilizer'
  WHEN lower(category) LIKE '%pesti%'   OR lower(category) LIKE '%spray%'  THEN 'pesticide'
  WHEN lower(category) LIKE '%equip%'                                       THEN 'equipment'
  WHEN lower(category) LIKE '%machine%' OR lower(category) LIKE '%tractor%' THEN 'machinery_rent'
  WHEN lower(category) LIKE '%fuel%'    OR lower(category) LIKE '%diesel%' OR lower(category) LIKE '%petrol%' THEN 'fuel'
  WHEN lower(category) LIKE '%irrig%'   OR lower(category) LIKE '%water%'  THEN 'irrigation'
  WHEN lower(category) LIKE '%transport%' THEN 'transport'
  WHEN lower(category) LIKE '%elec%'     OR lower(category) LIKE '%vij%'    THEN 'electricity'
  WHEN lower(category) LIKE '%pack%'      THEN 'packaging'
  ELSE 'other'
END
WHERE category_id IS NULL;
");

            // ── E. Fail-fast guard — no NULLs may survive the backfill ─
            migrationBuilder.Sql(@"
DO $$
DECLARE
    unmapped_count int;
BEGIN
    SELECT COUNT(*) INTO unmapped_count
    FROM ssf.cost_entries
    WHERE category_id IS NULL;

    IF unmapped_count > 0 THEN
        RAISE EXCEPTION 'AddCostCategoriesLookup: backfill left % cost_entries rows with NULL category_id. Inspect ssf.cost_entries before re-running.', unmapped_count;
    END IF;
END;
$$ LANGUAGE plpgsql;
");

            // ── F. Tighten category_id to NOT NULL ───────────────────
            migrationBuilder.AlterColumn<string>(
                name: "category_id",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(48)",
                maxLength: 48,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(48)",
                oldMaxLength: 48,
                oldNullable: true);

            // ── G. Index + Foreign key (RESTRICT) ────────────────────
            migrationBuilder.CreateIndex(
                name: "ix_cost_entries_category_id",
                schema: "ssf",
                table: "cost_entries",
                column: "category_id");

            migrationBuilder.AddForeignKey(
                name: "FK_cost_entries_cost_categories_category_id",
                schema: "ssf",
                table: "cost_entries",
                column: "category_id",
                principalSchema: "ssf",
                principalTable: "cost_categories",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            // ── H. Drop legacy free-text category column ─────────────
            migrationBuilder.DropColumn(
                name: "category",
                schema: "ssf",
                table: "cost_entries");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reverse H → A. Re-add the legacy text column nullable so
            // the join-backfill can populate it; then tighten to NOT NULL.
            migrationBuilder.AddColumn<string>(
                name: "category",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            // Reverse-backfill from the lookup's English label so the
            // round-trip is human-readable. Free-text values that were
            // originally normalised into a canonical code cannot be
            // reconstructed verbatim (matches the 02.2/02.3 down
            // convention).
            migrationBuilder.Sql(@"
UPDATE ssf.cost_entries ce
SET category = cc.display_en
FROM ssf.cost_categories cc
WHERE ce.category_id = cc.id
  AND ce.category IS NULL;

UPDATE ssf.cost_entries SET category = 'Other' WHERE category IS NULL;
");

            migrationBuilder.AlterColumn<string>(
                name: "category",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80,
                oldNullable: true);

            migrationBuilder.DropForeignKey(
                name: "FK_cost_entries_cost_categories_category_id",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropIndex(
                name: "ix_cost_entries_category_id",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "category_id",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropTable(
                name: "cost_categories",
                schema: "ssf");
        }
    }
}
