// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146): <c>ssf.pictures</c>, the picture that shows who made a
    /// schedule. One current row per (<c>kind</c>, <c>subject_id</c>): PERSON (subject = a user id: his own face or chosen image), SCHEDULE (subject
    /// = the root template id of an edit chain: one own schedule's picture) or INSTITUTION (subject = the root of an outside, Public schedule: its
    /// logo). The row holds where the file is, its type, size and SHA-256, and who set it when - never the image.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. One new table and nothing else: no column on an existing table, no
    /// existing policy, grant, constraint or row changes (<c>ssf.schedule_templates</c>, which stays RLS-exempt, is NOT touched, and no picture
    /// hangs on a version row). The currently deployed binary never names the table, so it runs unchanged against the migrated schema (P11).
    /// A FORCE ROW LEVEL SECURITY here constrains only this new table.</para>
    ///
    /// <para><b>Row security: the shape, and why (verified against the repo, not copied).</b> <c>ssf.schedule_templates</c>'s exemption is NOT
    /// copied (a person's face is personal data). The farm-keyed shape of <c>20261113090000_AddScheduleStepMoves</c> (<c>p_tenant_*</c> on
    /// <c>farm_id</c> + Active-member <c>p_user_select_*</c>) does not fit either: a picture belongs to no farm (no <c>farm_id</c> column to key on, F8).
    /// The fitting shape is the user-keyed one of <c>ssf.correction_events</c> (<c>p_user_correction_events</c>, <c>user_id = agrisync.user_id</c>),
    /// written under <c>ICallerUserTenantScope</c>. Four policies, on <c>agrisync.user_id</c>:
    /// <list type="bullet">
    /// <item><b>SELECT: open to every user scope (<c>USING (true)</c>), on purpose.</b> A picture is read by people other than its setter (the
    /// owner's co-owner, mukadam and team see his face and his schedule's picture; everyone sees an institution logo). WHO may see which row is the
    /// application's rule (<c>PictureViewer</c>), asked by the file door and by the pull; this policy only keeps the FORCE-RLS read from returning
    /// nothing. Visible is not authorised (E4): no door serves a row without asking the viewer.</item>
    /// <item><b>INSERT / UPDATE (the new row): <c>set_by_user_id</c> = the caller's scope, and a PERSON row's subject IS the caller.</b> So a farm
    /// member, or any other person, can never write someone else's face, whatever the application does (E4).</item>
    /// <item><b>UPDATE / DELETE (the existing row)</b>: only its setter; a PERSON row only its person; <b>an INSTITUTION logo by any user scope</b>,
    /// because ShramSafal staff replace each other's logos and the database cannot know who is staff (the application asks
    /// <c>ModuleKey.ScheduleReview</c> first, <c>PictureSubject</c>). That is the one place the database defends less than the application; it is
    /// not a person's data. A write under no user scope (<c>agrisync.user_id</c> unset) is refused for every kind.</item>
    /// </list>
    /// The erasure worker (migration role, <c>row_security = off</c>) and the export worker are not bound by these policies.</para>
    ///
    /// <para><b>No foreign keys, on purpose (E4).</b> <c>subject_id</c> and <c>set_by_user_id</c> are opaque ids like
    /// <c>schedule_templates.owner_user_id</c> (no <c>ssf</c> table keys to <c>public.users</c>; a foreign key proves existence, not permission,
    /// and runs outside row-level security).</para>
    ///
    /// <para><b>Grants.</b> <c>agrisync_app</c> gets SELECT, INSERT, UPDATE, DELETE (current state, not a ledger: a replaced picture updates its row,
    /// a removed one deletes it; the history is the append-only audit row, <c>PictureSet</c> / <c>PictureRemoved</c>). TRUNCATE is revoked where the app
    /// role holds it (it is not a row operation, so no policy would see it).</para>
    ///
    /// <para><b>Down() REFUSES while any row exists</b> (<see cref="DownRefusalSql"/>): dropping the table would leave every picture FILE in the
    /// bucket with nothing naming it and nothing able to erase it for its owner (a person's face). Remove the pictures first (the owners, or erasure,
    /// delete the files with the rows). With no row it drops the four policies and the table, and nothing else.</para>
    /// </summary>
    public partial class AddPictures : Migration
    {
        private const string UserScope = "NULLIF(current_setting('agrisync.user_id', true), '')::uuid";

        internal const string SecuritySql = @"
ALTER TABLE ssf.pictures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.pictures FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_read_pictures ON ssf.pictures;
CREATE POLICY p_read_pictures ON ssf.pictures
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS p_insert_pictures ON ssf.pictures;
CREATE POLICY p_insert_pictures ON ssf.pictures
  FOR INSERT
  WITH CHECK (
    set_by_user_id = " + UserScope + @"
    AND (kind <> 'PERSON' OR subject_id = set_by_user_id)
  );

DROP POLICY IF EXISTS p_update_pictures ON ssf.pictures;
CREATE POLICY p_update_pictures ON ssf.pictures
  FOR UPDATE
  USING (
    " + UserScope + @" IS NOT NULL
    AND (kind = 'INSTITUTION' OR set_by_user_id = " + UserScope + @")
  )
  WITH CHECK (
    set_by_user_id = " + UserScope + @"
    AND (kind <> 'PERSON' OR subject_id = set_by_user_id)
  );

DROP POLICY IF EXISTS p_delete_pictures ON ssf.pictures;
CREATE POLICY p_delete_pictures ON ssf.pictures
  FOR DELETE
  USING (
    " + UserScope + @" IS NOT NULL
    AND (kind = 'INSTITUTION' OR set_by_user_id = " + UserScope + @")
  );

DO $$
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; picture grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.pictures TO agrisync_app;
    -- TRUNCATE is not a row operation, so no policy would see it: revoked where the app role holds it.
    IF has_table_privilege('agrisync_app', 'ssf.pictures'::regclass, 'TRUNCATE') THEN
        REVOKE TRUNCATE ON ssf.pictures FROM agrisync_app;
    END IF;
END $$;
";

        /// <summary>Down()'s refusal. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_rows bigint;
BEGIN
    SELECT count(*) INTO v_rows FROM ssf.pictures;
    IF v_rows > 0 THEN
        RAISE EXCEPTION 'Down refused: % picture row(s) exist in ssf.pictures. Dropping the table would leave their files in storage with nothing naming them and nothing able to erase them for their owners. Remove the pictures first (the owners remove them, or erasure deletes them with their files), then run Down again. Nothing changed.', v_rows;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "pictures",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    subject_id = table.Column<Guid>(type: "uuid", nullable: false),
                    storage_key = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    content_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    bytes = table.Column<int>(type: "integer", nullable: false),
                    sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    set_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    set_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pictures", x => x.Id);
                    table.CheckConstraint("ck_pictures_bytes", "bytes > 0 AND bytes <= 524288");
                    table.CheckConstraint("ck_pictures_kind", "kind IN ('PERSON','SCHEDULE','INSTITUTION')");
                });

            migrationBuilder.CreateIndex(
                name: "ix_pictures_set_by",
                schema: "ssf",
                table: "pictures",
                column: "set_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ux_pictures_kind_subject",
                schema: "ssf",
                table: "pictures",
                columns: new[] { "kind", "subject_id" },
                unique: true);

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never orphans a person's picture file. Raises (and so changes nothing) while any row exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_delete_pictures ON ssf.pictures;
DROP POLICY IF EXISTS p_update_pictures ON ssf.pictures;
DROP POLICY IF EXISTS p_insert_pictures ON ssf.pictures;
DROP POLICY IF EXISTS p_read_pictures ON ssf.pictures;
");

            migrationBuilder.DropTable(
                name: "pictures",
                schema: "ssf");
        }
    }
}
