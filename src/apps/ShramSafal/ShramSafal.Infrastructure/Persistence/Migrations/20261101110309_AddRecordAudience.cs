using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 lane PRV (founder D-26, 2026-10-27; Q3 2026-10-30) — who may see ONE record.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE: <c>audience</c> on
    /// <c>ssf.daily_logs</c> and <c>ssf.cost_entries</c> is NOT NULL DEFAULT 'Team' (CHECK-constrained to the three member
    /// names), so every existing record keeps exactly today's behaviour and an older binary that inserts without the
    /// column writes 'Team'; <c>audience_changed_at_utc</c> is NULLABLE (never changed). One new table,
    /// <c>ssf.record_audience_members</c> (the people chosen for a "Selected" record), FORCE-RLS from birth on its own
    /// <c>farm_id</c> (F8 — a direct tenant column, never an EXISTS through a parent), with a user-scoped read policy:
    /// in a USER-scoped read (no farm scope set) a person reads only the rows that name HIM, and the farm's registrant
    /// (the record holder, fix pass 1 L2) reads them all. It is narrow ONLY there: in a FARM-scoped request the tenant
    /// policy admits every row of the farm, so who else was chosen is kept from members by application code (the
    /// audience and its people go to the holder alone; the AudienceChanged audit rows are his alone — fix pass 1, L3).
    /// No existing column, constraint or policy changes, so the deployed binary runs unchanged against the migrated
    /// schema (it never names the new columns or table).</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops <c>ssf.record_audience_members</c> and the
    /// two columns on each table: EVERY audience the primary account holder chose is forgotten, and every record he made
    /// "Only me" or "Selected" becomes visible to the normal team again on the next pull. The audit rows that recorded
    /// each change (who, when, from → to) stay. Rolling back past this migration after a holder has used it is a founder
    /// decision.</para>
    /// </summary>
    public partial class AddRecordAudience : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.daily_logs ADD CONSTRAINT ck_daily_logs_audience CHECK (audience IN ('Team', 'Selected', 'OnlyMe'));
ALTER TABLE ssf.cost_entries ADD CONSTRAINT ck_cost_entries_audience CHECK (audience IN ('Team', 'Selected', 'OnlyMe'));
ALTER TABLE ssf.record_audience_members ADD CONSTRAINT ck_record_audience_members_kind CHECK (record_kind IN ('DailyLog', 'CostEntry'));
ALTER TABLE ssf.record_audience_members ADD CONSTRAINT ""FK_record_audience_members_farms_farm_id""
  FOREIGN KEY (farm_id) REFERENCES ssf.farms (""Id"") ON DELETE RESTRICT;

ALTER TABLE ssf.record_audience_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.record_audience_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_record_audience_members ON ssf.record_audience_members;
CREATE POLICY p_tenant_record_audience_members ON ssf.record_audience_members
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_record_audience_members ON ssf.record_audience_members;
CREATE POLICY p_user_select_record_audience_members ON ssf.record_audience_members
  FOR SELECT
  USING (
    user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM ssf.farms f
      WHERE f.""Id"" = record_audience_members.farm_id
        AND f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
    )
  );

DO $$
BEGIN
    -- A new table gets its grants in the migration that creates it (20260831180408_AddAttendanceMarks's lesson).
    -- No UPDATE: a chosen person is added or removed, never edited. No TRUNCATE.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, DELETE ON ssf.record_audience_members TO agrisync_app;
        IF has_table_privilege('agrisync_app', 'ssf.record_audience_members', 'UPDATE')
           OR has_table_privilege('agrisync_app', 'ssf.record_audience_members', 'TRUNCATE') THEN
            REVOKE UPDATE, TRUNCATE ON ssf.record_audience_members FROM agrisync_app;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
        GRANT SELECT ON ssf.record_audience_members TO agrisync_readonly;
    END IF;
END
$$;
";
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "audience",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Team");

            migrationBuilder.AddColumn<DateTime>(
                name: "audience_changed_at_utc",
                schema: "ssf",
                table: "daily_logs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "audience",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Team");

            migrationBuilder.AddColumn<DateTime>(
                name: "audience_changed_at_utc",
                schema: "ssf",
                table: "cost_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "record_audience_members",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    record_kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    record_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    added_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_record_audience_members", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_record_audience_members_farm_id",
                schema: "ssf",
                table: "record_audience_members",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_record_audience_members_user_id",
                schema: "ssf",
                table: "record_audience_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ux_record_audience_members_record_user",
                schema: "ssf",
                table: "record_audience_members",
                columns: new[] { "record_kind", "record_id", "user_id" },
                unique: true);

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every chosen audience is forgotten; restricted records return to
            // the normal team. The audit rows of each change stay.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_user_select_record_audience_members ON ssf.record_audience_members;
DROP POLICY IF EXISTS p_tenant_record_audience_members ON ssf.record_audience_members;
ALTER TABLE ssf.daily_logs DROP CONSTRAINT IF EXISTS ck_daily_logs_audience;
ALTER TABLE ssf.cost_entries DROP CONSTRAINT IF EXISTS ck_cost_entries_audience;
");

            migrationBuilder.DropTable(
                name: "record_audience_members",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "audience",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "audience_changed_at_utc",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "audience",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "audience_changed_at_utc",
                schema: "ssf",
                table: "cost_entries");
        }
    }
}
