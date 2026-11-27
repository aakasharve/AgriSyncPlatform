// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S2) - the government village list (LGD) on the server.
using System;
using Microsoft.EntityFrameworkCore.Migrations;
using User.Infrastructure.Places;

#nullable disable

namespace User.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Pilot lane IDENT (S2): four reference tables in <c>public</c> (User context) - <c>lgd_districts</c>, <c>lgd_talukas</c>,
    /// <c>lgd_villages</c> (keyed by the village LGD code, the join key) and <c>lgd_list_versions</c> (one row per version loaded, with its
    /// counts, source and provenance "Secondary source; not independently verified").
    ///
    /// <para><b>The data.</b> Up() loads version <c>lgd-mh-2026-11-26</c> from the file this assembly embeds (<see cref="LgdPlaceList"/>,
    /// built by <c>ops/places/build_place_list.py</c>): 44,930 villages, 358 talukas, 35 districts, then a DO block that RAISES (and so fails the
    /// migration and the boot) unless the tables hold exactly those counts, then the version row. This migration names its version explicitly,
    /// so the embedded file of that version must stay in the assembly while this migration exists. The statements are the boot check's own
    /// (<see cref="LgdPlaceListLoader.Statements"/>).</para>
    ///
    /// <para><b>Read-only for the app role.</b> Row security is ENABLED (not forced, so the table owner - the migration role - can load a later
    /// version) with one read policy open to everyone and no write policy, so every INSERT, UPDATE or DELETE of <c>agrisync_app</c> is refused
    /// whatever grants it holds; SELECT is granted explicitly and INSERT, UPDATE, DELETE, TRUNCATE are revoked (role-guarded). No person's
    /// data is in these tables.</para>
    ///
    /// <para><b>Behaviour.</b> Additive: four new tables. No existing table, column, policy, grant or row is touched; an older binary does not map
    /// them and runs unchanged. <b>Down()</b> drops the four tables (their policies, constraints and the loaded list go with them; the list is
    /// rebuilt from the embedded file by Up() or by the boot check). It touches nothing else.</para>
    /// </summary>
    public partial class AddLgdPlaceList : Migration
    {
        /// <summary>The list version this migration loads (never the "current" one: a later list is a later step).</summary>
        internal const string LoadedVersion = "lgd-mh-2026-11-26";

        internal const string ConstraintsSql = @"
ALTER TABLE public.lgd_villages ADD CONSTRAINT ck_lgd_villages_status CHECK (status IN (1, 2, 3));
ALTER TABLE public.lgd_villages ADD CONSTRAINT ck_lgd_villages_pin CHECK (pin IS NULL OR pin ~ '^[1-9][0-9]{5}$');
";

        internal const string SecuritySql = @"
ALTER TABLE public.lgd_districts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lgd_districts_read ON public.lgd_districts;
CREATE POLICY p_lgd_districts_read ON public.lgd_districts FOR SELECT USING (true);
ALTER TABLE public.lgd_talukas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lgd_talukas_read ON public.lgd_talukas;
CREATE POLICY p_lgd_talukas_read ON public.lgd_talukas FOR SELECT USING (true);
ALTER TABLE public.lgd_villages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lgd_villages_read ON public.lgd_villages;
CREATE POLICY p_lgd_villages_read ON public.lgd_villages FOR SELECT USING (true);
ALTER TABLE public.lgd_list_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lgd_list_versions_read ON public.lgd_list_versions;
CREATE POLICY p_lgd_list_versions_read ON public.lgd_list_versions FOR SELECT USING (true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT ON public.lgd_districts, public.lgd_talukas, public.lgd_villages, public.lgd_list_versions TO agrisync_app;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.lgd_districts, public.lgd_talukas, public.lgd_villages, public.lgd_list_versions FROM agrisync_app;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "lgd_districts",
                schema: "public",
                columns: table => new
                {
                    code = table.Column<int>(type: "integer", nullable: false),
                    name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    name_mr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    list_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lgd_districts", x => x.code);
                });

            migrationBuilder.CreateTable(
                name: "lgd_list_versions",
                schema: "public",
                columns: table => new
                {
                    version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    loaded_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    village_count = table.Column<int>(type: "integer", nullable: false),
                    taluka_count = table.Column<int>(type: "integer", nullable: false),
                    district_count = table.Column<int>(type: "integer", nullable: false),
                    source = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    provenance = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lgd_list_versions", x => x.version);
                });

            migrationBuilder.CreateTable(
                name: "lgd_talukas",
                schema: "public",
                columns: table => new
                {
                    code = table.Column<int>(type: "integer", nullable: false),
                    district_code = table.Column<int>(type: "integer", nullable: false),
                    name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    name_mr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    list_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lgd_talukas", x => x.code);
                    table.ForeignKey(
                        name: "FK_lgd_talukas_lgd_districts_district_code",
                        column: x => x.district_code,
                        principalSchema: "public",
                        principalTable: "lgd_districts",
                        principalColumn: "code",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "lgd_villages",
                schema: "public",
                columns: table => new
                {
                    code = table.Column<int>(type: "integer", nullable: false),
                    taluka_code = table.Column<int>(type: "integer", nullable: false),
                    name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    name_mr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    pin = table.Column<string>(type: "character(6)", nullable: true),
                    status = table.Column<short>(type: "smallint", nullable: false),
                    list_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lgd_villages", x => x.code);
                    table.ForeignKey(
                        name: "FK_lgd_villages_lgd_talukas_taluka_code",
                        column: x => x.taluka_code,
                        principalSchema: "public",
                        principalTable: "lgd_talukas",
                        principalColumn: "code",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_lgd_talukas_district_code",
                schema: "public",
                table: "lgd_talukas",
                column: "district_code");

            migrationBuilder.CreateIndex(
                name: "IX_lgd_villages_taluka_code",
                schema: "public",
                table: "lgd_villages",
                column: "taluka_code");

            migrationBuilder.Sql(ConstraintsSql);

            // The list itself, its counts check (raises on a mismatch) and its version row.
            foreach (var statement in LgdPlaceListLoader.Statements(LgdPlaceList.LoadEmbedded(LoadedVersion)))
            {
                migrationBuilder.Sql(statement);
            }

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "lgd_list_versions",
                schema: "public");

            migrationBuilder.DropTable(
                name: "lgd_villages",
                schema: "public");

            migrationBuilder.DropTable(
                name: "lgd_talukas",
                schema: "public");

            migrationBuilder.DropTable(
                name: "lgd_districts",
                schema: "public");
        }
    }
}
