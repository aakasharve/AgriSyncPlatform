using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDfesQuestionContext : Migration
    {
        /// <summary>
        /// Lane DFES-Q — <c>ssf.question_photo_checks</c> is APPEND-ONLY BY PRIVILEGE with direct-farm_id FORCE RLS, the shape of
        /// 20261113120000_AddLogPracticeReasons and 20261017080742_EnforceAppendOnlyLedgerGrants: SELECT + INSERT for the app
        /// role, UPDATE/DELETE/TRUNCATE revoked, and the effective-privilege guard that fails the migration if any remains.
        /// The new nullable columns on ssf.question_events need nothing: that table is already append-only by privilege.
        /// </summary>
        internal const string SecuritySql = @"
ALTER TABLE ssf.question_photo_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.question_photo_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_question_photo_checks ON ssf.question_photo_checks;
CREATE POLICY p_tenant_question_photo_checks ON ssf.question_photo_checks
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DO $$
DECLARE
    v_rel      regclass := 'ssf.question_photo_checks'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; question-photo-check grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.question_photo_checks TO agrisync_app;
    -- A check is never edited and never removed: a re-check is a new row. TRUNCATE is not a row operation, so RLS never sees
    -- it; revoked with UPDATE and DELETE, only where the app role holds something.
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.question_photo_checks FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
    FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege('agrisync_app', v_rel, v_priv) THEN
            SELECT string_agg(
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                            WHEN a.grantee = 'agrisync_app'::regrole THEN 'agrisync_app (direct grant)'
                            ELSE a.grantee::regrole::text || ' (inherited by membership'
                                 || CASE WHEN a.grantee = c.relowner THEN ', table owner' ELSE '' END || ')'
                       END, ', ')
              INTO v_holders
              FROM pg_class c,
                   aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
             WHERE c.oid = v_rel
               AND a.privilege_type = v_priv
               AND (a.grantee = 0 OR pg_has_role('agrisync_app', a.grantee, 'USAGE'));

            v_failures := v_failures || format(E'\n  %s %s via %s', v_rel, v_priv,
                COALESCE(v_holders, 'superuser (agrisync_app bypasses privilege checks)'));
        END IF;
    END LOOP;

    IF pg_has_role('agrisync_app', v_owner, 'MEMBER') THEN
        RAISE WARNING
            '% is owned by % and agrisync_app can act as that owner: statements issued as agrisync_app are now refused UPDATE/DELETE/TRUNCATE, but the owner can re-grant them and can drop the table. Containment against the owner needs ownership moved to a role agrisync_app is not a member of.',
            v_rel, v_owner;
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'ssf.question_photo_checks is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "asked_user_id",
                schema: "ssf",
                table: "question_events",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "deviation_challenge",
                schema: "ssf",
                table: "question_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "deviation_reason_code",
                schema: "ssf",
                table: "question_events",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "photo_attachment_id",
                schema: "ssf",
                table: "question_events",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "prompt_origin",
                schema: "ssf",
                table: "question_events",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "prompt_text",
                schema: "ssf",
                table: "question_events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "question_kind",
                schema: "ssf",
                table: "question_events",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "schedule_card_ref",
                schema: "ssf",
                table: "question_events",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source_refs",
                schema: "ssf",
                table: "question_events",
                type: "jsonb",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "question_photo_checks",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question_event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    attachment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    stated_count = table.Column<int>(type: "integer", nullable: true),
                    stated_out_of = table.Column<int>(type: "integer", nullable: true),
                    read_count = table.Column<int>(type: "integer", nullable: true),
                    read_out_of = table.Column<int>(type: "integer", nullable: true),
                    confidence = table.Column<decimal>(type: "numeric(5,4)", precision: 5, scale: 4, nullable: true),
                    verdict = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    model = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    detail = table.Column<string>(type: "jsonb", nullable: true),
                    read_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_photo_checks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_question_photo_checks_question_events_question_event_id",
                        column: x => x.question_event_id,
                        principalSchema: "ssf",
                        principalTable: "question_events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_question_events_farm_asked_user",
                schema: "ssf",
                table: "question_events",
                columns: new[] { "farm_id", "asked_user_id" });

            migrationBuilder.CreateIndex(
                name: "ix_question_photo_checks_farm_id",
                schema: "ssf",
                table: "question_photo_checks",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_question_photo_checks_question_event_id",
                schema: "ssf",
                table: "question_photo_checks",
                column: "question_event_id");

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP POLICY IF EXISTS p_tenant_question_photo_checks ON ssf.question_photo_checks;");

            migrationBuilder.DropTable(
                name: "question_photo_checks",
                schema: "ssf");

            migrationBuilder.DropIndex(
                name: "ix_question_events_farm_asked_user",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "asked_user_id",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "deviation_challenge",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "deviation_reason_code",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "photo_attachment_id",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "prompt_origin",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "prompt_text",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "question_kind",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "schedule_card_ref",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "source_refs",
                schema: "ssf",
                table: "question_events");
        }
    }
}
