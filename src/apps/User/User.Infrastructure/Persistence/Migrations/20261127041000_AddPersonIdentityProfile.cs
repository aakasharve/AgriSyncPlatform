// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - a person's own identity card on the server.
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace User.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Pilot lane IDENT (S1): <c>public.user_identity_profiles</c> (User context), one row per login, made on his first save: his name in
    /// Marathi and in English letters with how each came to be (Typed / ConvertedConfirmed; an unconfirmed suggestion is never stored), his
    /// Farmer ID (always Unverified), his village, taluka and district (an LGD code and the list's names as of the save, or the text he typed,
    /// with the basis List / NotInList), the list version, his PIN with its basis, the save's time and app version (E9) and a version counter
    /// (the concurrency token). The key is his user id, a foreign key to <c>public.users("Id")</c> ON DELETE CASCADE.
    ///
    /// <para><b>Checks</b> (each written so an unknown part counts as broken, never as passing): a basis is present exactly when its value is,
    /// and holds one of its words; a List place has a code and a name, a
    /// NotInList place a name and no code; a PIN is six digits not starting with 0; the Farmer ID status is Unverified (0); the version is 1 or
    /// more.</para>
    ///
    /// <para><b>No row security</b>, like <c>public.users</c>: the only doors are the person's own (the id comes from his token) and the two
    /// pinned name readers (the pull's people rows and <c>/me/context</c>), which read <c>name_mr</c> / <c>name_en</c> only. SELECT, INSERT and
    /// UPDATE are granted to the app role (role-guarded); it never deletes a card (the erasure worker does, on the migration connection).</para>
    ///
    /// <para><b>Behaviour.</b> Additive: one new table. No existing table, column, policy, grant or row changes; an older binary does not map it
    /// and runs unchanged. <b>Down()</b> REFUSES while any card exists (a card is what a person typed about himself: a rollback must not
    /// silently lose it; the deploy rollback plan relies on the snapshot); on an empty table it drops the table and nothing else.</para>
    /// </summary>
    public partial class AddPersonIdentityProfile : Migration
    {
        internal const string ChecksSql = @"
ALTER TABLE public.user_identity_profiles ADD CONSTRAINT ck_user_identity_profiles_version CHECK (version >= 1);
ALTER TABLE public.user_identity_profiles ADD CONSTRAINT ck_user_identity_profiles_name_mr CHECK (COALESCE((
    (name_mr IS NULL AND name_mr_basis IS NULL) OR (name_mr IS NOT NULL AND name_mr_basis IN (1, 2))), false));
ALTER TABLE public.user_identity_profiles ADD CONSTRAINT ck_user_identity_profiles_name_en CHECK (COALESCE((
    (name_en IS NULL AND name_en_basis IS NULL) OR (name_en IS NOT NULL AND name_en_basis IN (1, 2))), false));
ALTER TABLE public.user_identity_profiles ADD CONSTRAINT ck_user_identity_profiles_farmer_id_status CHECK (farmer_id_status = 0);
ALTER TABLE public.user_identity_profiles ADD CONSTRAINT ck_user_identity_profiles_pin CHECK (COALESCE((
    (pin_code IS NULL AND pin_basis IS NULL) OR (pin_code ~ '^[1-9][0-9]{5}$' AND pin_basis IN (1, 2))), false));
ALTER TABLE public.user_identity_profiles ADD CONSTRAINT ck_user_identity_profiles_village CHECK (COALESCE((
    (village_basis IS NULL AND village_lgd_code IS NULL AND village_name_mr IS NULL AND village_name_en IS NULL)
    OR (village_basis = 1 AND village_lgd_code IS NOT NULL AND (village_name_mr IS NOT NULL OR village_name_en IS NOT NULL))
    OR (village_basis = 2 AND village_lgd_code IS NULL AND (village_name_mr IS NOT NULL OR village_name_en IS NOT NULL))), false));
ALTER TABLE public.user_identity_profiles ADD CONSTRAINT ck_user_identity_profiles_taluka CHECK (COALESCE((
    (taluka_basis IS NULL AND taluka_lgd_code IS NULL AND taluka_name_mr IS NULL AND taluka_name_en IS NULL)
    OR (taluka_basis = 1 AND taluka_lgd_code IS NOT NULL AND (taluka_name_mr IS NOT NULL OR taluka_name_en IS NOT NULL))
    OR (taluka_basis = 2 AND taluka_lgd_code IS NULL AND (taluka_name_mr IS NOT NULL OR taluka_name_en IS NOT NULL))), false));
ALTER TABLE public.user_identity_profiles ADD CONSTRAINT ck_user_identity_profiles_district CHECK (COALESCE((
    (district_basis IS NULL AND district_lgd_code IS NULL AND district_name_mr IS NULL AND district_name_en IS NULL)
    OR (district_basis = 1 AND district_lgd_code IS NOT NULL AND (district_name_mr IS NOT NULL OR district_name_en IS NOT NULL))
    OR (district_basis = 2 AND district_lgd_code IS NULL AND (district_name_mr IS NOT NULL OR district_name_en IS NOT NULL))), false));
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, UPDATE ON public.user_identity_profiles TO agrisync_app;
    END IF;
END $$;
";

        internal const string DownGuardSql = @"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.user_identity_profiles) THEN
        RAISE EXCEPTION 'AddPersonIdentityProfile Down(): % identity card(s) exist; a rollback would lose what people typed about themselves. Restore from the pre-migration snapshot instead.',
            (SELECT count(*) FROM public.user_identity_profiles);
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_identity_profiles",
                schema: "public",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    name_mr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    name_mr_basis = table.Column<short>(type: "smallint", nullable: true),
                    name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    name_en_basis = table.Column<short>(type: "smallint", nullable: true),
                    farmer_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    farmer_id_status = table.Column<short>(type: "smallint", nullable: false),
                    village_lgd_code = table.Column<int>(type: "integer", nullable: true),
                    village_name_mr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    village_name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    village_basis = table.Column<short>(type: "smallint", nullable: true),
                    taluka_lgd_code = table.Column<int>(type: "integer", nullable: true),
                    taluka_name_mr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    taluka_name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    taluka_basis = table.Column<short>(type: "smallint", nullable: true),
                    district_lgd_code = table.Column<int>(type: "integer", nullable: true),
                    district_name_mr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    district_name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    district_basis = table.Column<short>(type: "smallint", nullable: true),
                    place_list_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    pin_code = table.Column<string>(type: "character(6)", nullable: true),
                    pin_basis = table.Column<short>(type: "smallint", nullable: true),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_app_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_identity_profiles", x => x.user_id);
                    table.ForeignKey(
                        name: "FK_user_identity_profiles_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "public",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_user_identity_profiles_village_lgd_code",
                schema: "public",
                table: "user_identity_profiles",
                column: "village_lgd_code");

            migrationBuilder.Sql(ChecksSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(DownGuardSql);

            migrationBuilder.DropTable(
                name: "user_identity_profiles",
                schema: "public");
        }
    }
}
