// spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78 "the primary owner decides who sees which
    /// reminders, who may customise, whose reminders always show", D-79, D-84 = 1; R17, R21): the owner's reminder settings.
    /// <c>ssf.farm_reminder_settings</c> (one row per farm, made on the owner's first change; defaults D-79) and
    /// <c>ssf.reminder_always_show</c> (the people whose reminders always show to everyone on the plot), plus one nullable column on
    /// <c>ssf.planned_work</c>: <c>reminder_audience_changed_at_utc</c>, the stamp that lets the pull name a reminder (content-free) to a
    /// phone that no longer may see it after a setting changed - and to nobody else (P10).
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Two new tables and one new nullable column. No existing
    /// policy, grant, constraint or row changes. The currently deployed binary never names the tables or the column, so it runs unchanged
    /// against the migrated schema (P11). A farm with no settings row behaves exactly as before (the D-79 defaults).</para>
    ///
    /// <para><b>FORCE-RLS from birth</b>, tenant-scoped on each table's own <c>farm_id</c> (F8; the <c>p_tenant_*</c> shape of
    /// <c>AddPlannedWork</c>), and readable by the farm's owner or an ACTIVE member (<c>m.status = 3</c>) for the pull, which reads
    /// user-scoped (the <c>p_user_select_*</c> shape of <c>AddPlannedWork</c>): the application's rule decides WHO may read the settings
    /// themselves over REST (the primary owner and a holder of "आठवणींची मांडणी बदलणे"), and the pull only ever turns them into "may
    /// this reader see this reminder".</para>
    ///
    /// <para><b>Grants.</b> <c>agrisync_app</c> gets SELECT, INSERT, UPDATE and DELETE on both: they hold CURRENT STATE, not a ledger (a
    /// person can be unmarked); the history of every change is the append-only audit row (P3), which carries no reminder words. No
    /// foreign key to <c>ssf.farms</c>, on purpose (the dev-only demo-farm clear knows nothing of these tables; the door checks the farm
    /// and that a marked person is an Active member of it, E4).</para>
    ///
    /// <para><b>Erasure.</b> The rows hold person ids only (who marked whom, who last changed a choice): see the KEEP disposition in
    /// <c>ErasureWorker.cs</c>.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops both tables and the column: every farm's reminder settings
    /// and always-show marks are lost, and every reminder falls back to the D-79 base (the maker and the owner; schedule steps for the
    /// plot team). No reminder, task or audit row is touched.</para>
    /// </summary>
    public partial class AddReminderSettings : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.farm_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_reminder_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_farm_reminder_settings ON ssf.farm_reminder_settings;
CREATE POLICY p_tenant_farm_reminder_settings ON ssf.farm_reminder_settings
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_farm_reminder_settings ON ssf.farm_reminder_settings;
CREATE POLICY p_user_select_farm_reminder_settings ON ssf.farm_reminder_settings
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = farm_reminder_settings.farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

ALTER TABLE ssf.reminder_always_show ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.reminder_always_show FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_reminder_always_show ON ssf.reminder_always_show;
CREATE POLICY p_tenant_reminder_always_show ON ssf.reminder_always_show
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_reminder_always_show ON ssf.reminder_always_show;
CREATE POLICY p_user_select_reminder_always_show ON ssf.reminder_always_show
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = reminder_always_show.farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

DO $$
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; reminder-settings grants not applicable here.';
        RETURN;
    END IF;

    -- Current state, not ledgers: a mark can be taken off, a choice changed. The history is the audit row.
    GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.farm_reminder_settings, ssf.reminder_always_show TO agrisync_app;
END
$$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "reminder_audience_changed_at_utc",
                schema: "ssf",
                table: "planned_work",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "farm_reminder_settings",
                schema: "ssf",
                columns: table => new
                {
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    log_reminders_audience = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValueSql: "'MakerAndOwner'"),
                    own_reminders_audience = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValueSql: "'MakerAndOwner'"),
                    schedule_reminders_audience = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValueSql: "'PlotTeam'"),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_reminder_settings", x => x.farm_id);
                    table.CheckConstraint("ck_farm_reminder_settings_log", "log_reminders_audience IN ('MakerAndOwner','PlotTeam')");
                    table.CheckConstraint("ck_farm_reminder_settings_own", "own_reminders_audience IN ('MakerAndOwner','PlotTeam')");
                    table.CheckConstraint("ck_farm_reminder_settings_schedule", "schedule_reminders_audience IN ('PlotTeam','Planners')");
                });

            migrationBuilder.CreateTable(
                name: "reminder_always_show",
                schema: "ssf",
                columns: table => new
                {
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    added_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    added_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_reminder_always_show", x => new { x.farm_id, x.user_id });
                });

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every farm's reminder settings and always-show marks go; no reminder, task or
            // audit row is touched.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_reminder_always_show ON ssf.reminder_always_show;
DROP POLICY IF EXISTS p_tenant_reminder_always_show ON ssf.reminder_always_show;
DROP POLICY IF EXISTS p_user_select_farm_reminder_settings ON ssf.farm_reminder_settings;
DROP POLICY IF EXISTS p_tenant_farm_reminder_settings ON ssf.farm_reminder_settings;
");

            migrationBuilder.DropTable(
                name: "reminder_always_show",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "farm_reminder_settings",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "reminder_audience_changed_at_utc",
                schema: "ssf",
                table: "planned_work");
        }
    }
}
