using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ScheduleTemplateAuthorshipAndVersioning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "created_by_user_id",
                schema: "ssf",
                table: "schedule_templates",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "derived_from_template_id",
                schema: "ssf",
                table: "schedule_templates",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "previous_version_id",
                schema: "ssf",
                table: "schedule_templates",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "published_at_utc",
                schema: "ssf",
                table: "schedule_templates",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "tenant_scope",
                schema: "ssf",
                table: "schedule_templates",
                type: "integer",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.AddColumn<int>(
                name: "version",
                schema: "ssf",
                table: "schedule_templates",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<DateTime>(
                name: "overridden_at_utc",
                schema: "ssf",
                table: "planned_activities",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "overridden_by_user_id",
                schema: "ssf",
                table: "planned_activities",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "override_reason",
                schema: "ssf",
                table: "planned_activities",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "removed_at_utc",
                schema: "ssf",
                table: "planned_activities",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "removed_by_user_id",
                schema: "ssf",
                table: "planned_activities",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "removed_reason",
                schema: "ssf",
                table: "planned_activities",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "source_template_activity_id",
                schema: "ssf",
                table: "planned_activities",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "deviation_note",
                schema: "ssf",
                table: "log_tasks",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "deviation_reason_code",
                schema: "ssf",
                table: "log_tasks",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "execution_status",
                schema: "ssf",
                table: "log_tasks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Backfill: ensure existing rows have explicit version=1 and tenant_scope=3 (Public)
            migrationBuilder.Sql(
                "UPDATE ssf.schedule_templates SET version = 1, tenant_scope = 3 WHERE version IS NULL;");

            // Partial unique index for template lineage (WHERE clause not expressible via EF fluent API)
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX ix_schedule_templates_derived_version " +
                "ON ssf.schedule_templates (derived_from_template_id, version) " +
                "WHERE derived_from_template_id IS NOT NULL;");

            // CHECK constraint: non-Completed status requires deviation_reason_code; Completed forbids it
            migrationBuilder.Sql(
                "ALTER TABLE ssf.log_tasks ADD CONSTRAINT chk_logtask_deviation " +
                "CHECK ((execution_status = 0 AND deviation_reason_code IS NULL) " +
                "OR (execution_status <> 0 AND deviation_reason_code IS NOT NULL));");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE ssf.log_tasks DROP CONSTRAINT IF EXISTS chk_logtask_deviation;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ssf.ix_schedule_templates_derived_version;");

            migrationBuilder.DropColumn(
                name: "created_by_user_id",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "derived_from_template_id",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "previous_version_id",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "published_at_utc",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "tenant_scope",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "version",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "overridden_at_utc",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "overridden_by_user_id",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "override_reason",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "removed_at_utc",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "removed_by_user_id",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "removed_reason",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "source_template_activity_id",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "deviation_note",
                schema: "ssf",
                table: "log_tasks");

            migrationBuilder.DropColumn(
                name: "deviation_reason_code",
                schema: "ssf",
                table: "log_tasks");

            migrationBuilder.DropColumn(
                name: "execution_status",
                schema: "ssf",
                table: "log_tasks");
        }
    }
}
