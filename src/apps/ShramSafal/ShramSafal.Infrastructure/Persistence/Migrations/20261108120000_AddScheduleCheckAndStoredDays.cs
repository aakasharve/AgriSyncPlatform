// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-A)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 lane SCH-A (founder D-74, L8-R) - a schedule ShramSafal has checked, day by day.
    ///
    /// <para><b>What it adds.</b> (1) <c>ssf.schedule_template_stages</c>: a schedule row's STORED stages (the library used to
    /// invent them by an equal split). (2) Columns on <c>ssf.template_activities</c>: <c>end_day</c>, <c>frequency_mode</c>
    /// (<c>OneTime|EveryNDays|PerWeek</c>), <c>interval_days</c>, <c>part</c>, <c>operation_key</c> (WORK-ID's keys, W003),
    /// and (rounds 3) <c>after_activity_id</c> (R34), <c>role</c> and <c>nutrient_key</c> (D-104a). NULL on every existing row
    /// = "days not stored" (never checkable, R3/P4). (3) Columns on <c>ssf.schedule_templates</c>: <c>owner_type</c>,
    /// <c>source_label</c>, <c>crop_key</c>. (4) <c>ssf.schedule_checks</c>: ShramSafal's check of a library row, one
    /// unchangeable row per decision.</para>
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Only nullable columns and two new tables;
    /// no existing row, policy, grant or constraint changes. The currently deployed binary never names any of them, so it
    /// runs unchanged against the migrated schema (P11). <c>schedule_checks</c> is APPEND-ONLY BY PRIVILEGE: <c>agrisync_app</c>
    /// keeps SELECT + INSERT only, with the effective-privilege guard copied from
    /// <c>20261017080742_EnforceAppendOnlyLedgerGrants</c> (as <c>20261108090000_AddInputIdentityAssertions</c> does), which
    /// REFUSES the migration rather than record success if the app role can still UPDATE / DELETE / TRUNCATE.</para>
    ///
    /// <para><b>No row-level security on either new table, on purpose.</b> <c>schedule_template_stages</c> is author-scoped like
    /// <c>schedule_templates</c> (no farm owns it; the application's one visibility rule gates it). <c>schedule_checks</c> is
    /// ShramSafal platform data: no farm owns a check; writes are gated in the application by <c>schedules.review</c>; the
    /// database grants no UPDATE / DELETE. Both are argued onto <c>RlsExemptionAllowlistTests</c>.</para>
    ///
    /// <para><b>Down() REFUSES while any check exists</b> (E8: a rollback must not silently erase ShramSafal's checks). With
    /// none, it drops the two new tables and the new columns: it DESTROYS every stored stage, every stored activity day, repeat,
    /// part, operation key, role, nutrient key and order, and every row's owner type, source label and crop key (the schedules
    /// themselves and their names remain, and read as rows whose days are not stored). Rolling back past this migration after
    /// schedules were imported is a founder decision.</para>
    /// </summary>
    public partial class AddScheduleCheckAndStoredDays : Migration
    {
        /// <summary>Down() refuses while any check exists (E8). Tests execute this same text.</summary>
        internal const string RefuseDownWhileAnyCheckSql = @"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ssf.schedule_checks) THEN
        RAISE EXCEPTION
            'Down refused: ssf.schedule_checks holds ShramSafal''s checks of library schedules, and a rollback would erase them. Remove them deliberately (a founder decision) before rolling this migration back.';
    END IF;
END $$;
";

        /// <summary>The append-only grants and the effective-privilege guard. Tests execute this same text.</summary>
        internal const string SecuritySql = @"
DO $$
DECLARE
    v_rel      regclass := 'ssf.schedule_checks'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; schedule-check grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.schedule_checks TO agrisync_app;
    -- A check is never edited and never removed: a later decision is a new row, and the newest one is the row's state
    -- (doctrine P3). TRUNCATE is not a row operation, so it is revoked with UPDATE and DELETE. Revoked only where the app
    -- role holds something (the shape of 20261017080742_EnforceAppendOnlyLedgerGrants).
    IF has_table_privilege('agrisync_app', v_rel, 'UPDATE')
       OR has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.schedule_checks FROM agrisync_app;
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
            'ssf.schedule_checks is still mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "after_activity_id",
                schema: "ssf",
                table: "template_activities",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "end_day",
                schema: "ssf",
                table: "template_activities",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "frequency_mode",
                schema: "ssf",
                table: "template_activities",
                type: "character varying(12)",
                maxLength: 12,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "interval_days",
                schema: "ssf",
                table: "template_activities",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "nutrient_key",
                schema: "ssf",
                table: "template_activities",
                type: "character varying(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "operation_key",
                schema: "ssf",
                table: "template_activities",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "part",
                schema: "ssf",
                table: "template_activities",
                type: "character varying(12)",
                maxLength: 12,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "role",
                schema: "ssf",
                table: "template_activities",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "crop_key",
                schema: "ssf",
                table: "schedule_templates",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "owner_type",
                schema: "ssf",
                table: "schedule_templates",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source_label",
                schema: "ssf",
                table: "schedule_templates",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "schedule_checks",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_version = table.Column<int>(type: "integer", nullable: false),
                    decision = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    checked_activity_ids = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    checker_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    checker_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    checked_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_checks", x => x.id);
                    table.CheckConstraint("ck_schedule_checks_decision", "decision IN ('Approved', 'Returned', 'Withdrawn')");
                    table.CheckConstraint("ck_schedule_checks_note_when_not_approved", "decision = 'Approved' OR (note IS NOT NULL AND length(btrim(note)) > 0)");
                });

            migrationBuilder.CreateTable(
                name: "schedule_template_stages",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order_index = table.Column<short>(type: "smallint", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    start_day = table.Column<int>(type: "integer", nullable: false),
                    end_day = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_template_stages", x => x.id);
                    table.CheckConstraint("ck_schedule_template_stages_days", "start_day <= end_day");
                    table.ForeignKey(
                        name: "FK_schedule_template_stages_schedule_templates_schedule_templa~",
                        column: x => x.schedule_template_id,
                        principalSchema: "ssf",
                        principalTable: "schedule_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_schedule_checks_template_checked",
                schema: "ssf",
                table: "schedule_checks",
                columns: new[] { "schedule_template_id", "checked_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_schedule_template_stages_template",
                schema: "ssf",
                table: "schedule_template_stages",
                column: "schedule_template_id");

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: a rollback must never silently erase ShramSafal's checks. With any check present it REFUSES.
            migrationBuilder.Sql(RefuseDownWhileAnyCheckSql);

            migrationBuilder.DropTable(
                name: "schedule_checks",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "schedule_template_stages",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "after_activity_id",
                schema: "ssf",
                table: "template_activities");

            migrationBuilder.DropColumn(
                name: "end_day",
                schema: "ssf",
                table: "template_activities");

            migrationBuilder.DropColumn(
                name: "frequency_mode",
                schema: "ssf",
                table: "template_activities");

            migrationBuilder.DropColumn(
                name: "interval_days",
                schema: "ssf",
                table: "template_activities");

            migrationBuilder.DropColumn(
                name: "nutrient_key",
                schema: "ssf",
                table: "template_activities");

            migrationBuilder.DropColumn(
                name: "operation_key",
                schema: "ssf",
                table: "template_activities");

            migrationBuilder.DropColumn(
                name: "part",
                schema: "ssf",
                table: "template_activities");

            migrationBuilder.DropColumn(
                name: "role",
                schema: "ssf",
                table: "template_activities");

            migrationBuilder.DropColumn(
                name: "crop_key",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "owner_type",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "source_label",
                schema: "ssf",
                table: "schedule_templates");
        }
    }
}
