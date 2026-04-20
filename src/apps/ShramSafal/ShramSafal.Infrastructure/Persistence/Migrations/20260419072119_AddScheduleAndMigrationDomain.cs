using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddScheduleAndMigrationDomain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "crop_schedule_templates",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    crop_key = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    region_code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    version_tag = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    is_published = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_crop_schedule_templates", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "schedule_migration_events",
                schema: "ssf",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    prev_subscription_id = table.Column<Guid>(type: "uuid", nullable: false),
                    new_subscription_id = table.Column<Guid>(type: "uuid", nullable: false),
                    prev_schedule_id = table.Column<Guid>(type: "uuid", nullable: false),
                    new_schedule_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    migrated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    reason = table.Column<int>(type: "integer", nullable: false),
                    reason_text = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    compliance_at_migration_pct = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_migration_events", x => x.event_id);
                });

            migrationBuilder.CreateTable(
                name: "schedule_subscriptions",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_key = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    schedule_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_version_tag = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    adopted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    state = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    migrated_from_subscription_id = table.Column<Guid>(type: "uuid", nullable: true),
                    migrated_to_subscription_id = table.Column<Guid>(type: "uuid", nullable: true),
                    migration_reason = table.Column<int>(type: "integer", nullable: true),
                    state_changed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_subscriptions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "crop_schedule_prescribed_tasks",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    stage = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    day_offset = table.Column<int>(type: "integer", nullable: false),
                    tolerance_days_plus_minus = table.Column<int>(type: "integer", nullable: false, defaultValue: 2),
                    notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_crop_schedule_prescribed_tasks", x => new { x.schedule_template_id, x.id });
                    table.ForeignKey(
                        name: "FK_crop_schedule_prescribed_tasks_crop_schedule_templates_sche~",
                        column: x => x.schedule_template_id,
                        principalSchema: "ssf",
                        principalTable: "crop_schedule_templates",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_crop_schedule_prescribed_tasks_schedule_template_id",
                schema: "ssf",
                table: "crop_schedule_prescribed_tasks",
                column: "schedule_template_id");

            migrationBuilder.CreateIndex(
                name: "IX_crop_schedule_templates_crop_key_region_code",
                schema: "ssf",
                table: "crop_schedule_templates",
                columns: new[] { "crop_key", "region_code" });

            migrationBuilder.CreateIndex(
                name: "IX_crop_schedule_templates_template_key",
                schema: "ssf",
                table: "crop_schedule_templates",
                column: "template_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_schedule_migration_events_crop_cycle_id",
                schema: "ssf",
                table: "schedule_migration_events",
                column: "crop_cycle_id");

            migrationBuilder.CreateIndex(
                name: "IX_schedule_migration_events_farm_id",
                schema: "ssf",
                table: "schedule_migration_events",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "IX_schedule_migration_events_new_subscription_id",
                schema: "ssf",
                table: "schedule_migration_events",
                column: "new_subscription_id");

            migrationBuilder.CreateIndex(
                name: "IX_schedule_migration_events_plot_id",
                schema: "ssf",
                table: "schedule_migration_events",
                column: "plot_id");

            migrationBuilder.CreateIndex(
                name: "IX_schedule_migration_events_prev_subscription_id",
                schema: "ssf",
                table: "schedule_migration_events",
                column: "prev_subscription_id");

            migrationBuilder.CreateIndex(
                name: "IX_schedule_subscriptions_crop_cycle_id",
                schema: "ssf",
                table: "schedule_subscriptions",
                column: "crop_cycle_id");

            migrationBuilder.CreateIndex(
                name: "IX_schedule_subscriptions_farm_id",
                schema: "ssf",
                table: "schedule_subscriptions",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "IX_schedule_subscriptions_plot_id",
                schema: "ssf",
                table: "schedule_subscriptions",
                column: "plot_id");

            migrationBuilder.CreateIndex(
                name: "IX_schedule_subscriptions_schedule_template_id",
                schema: "ssf",
                table: "schedule_subscriptions",
                column: "schedule_template_id");

            migrationBuilder.CreateIndex(
                name: "ux_sched_sub_active",
                schema: "ssf",
                table: "schedule_subscriptions",
                columns: new[] { "plot_id", "crop_key", "crop_cycle_id" },
                unique: true,
                filter: "state = 0");

            // Invariant I-16: schedule_migration_events is append-only.
            // DB-level rules reject UPDATE and DELETE so a trust record cannot be rewritten.
            migrationBuilder.Sql(
                "CREATE RULE sched_mig_no_update AS ON UPDATE TO ssf.schedule_migration_events DO INSTEAD NOTHING;");
            migrationBuilder.Sql(
                "CREATE RULE sched_mig_no_delete AS ON DELETE TO ssf.schedule_migration_events DO INSTEAD NOTHING;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP RULE IF EXISTS sched_mig_no_delete ON ssf.schedule_migration_events;");
            migrationBuilder.Sql("DROP RULE IF EXISTS sched_mig_no_update ON ssf.schedule_migration_events;");

            migrationBuilder.DropTable(
                name: "crop_schedule_prescribed_tasks",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "schedule_migration_events",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "schedule_subscriptions",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "crop_schedule_templates",
                schema: "ssf");
        }
    }
}
