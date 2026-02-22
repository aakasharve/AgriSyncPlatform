using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAuditEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "ssf");

            migrationBuilder.CreateTable(
                name: "audit_events",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: true),
                    entity_type = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_role = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    payload = table.Column<string>(type: "text", nullable: false),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    client_command_id = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_events", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "cost_entries",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: true),
                    category = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    currency_code = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    entry_date = table.Column<DateOnly>(type: "date", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    is_corrected = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cost_entries", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "crop_cycles",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    stage = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    start_date = table.Column<DateOnly>(type: "date", nullable: false),
                    end_date = table.Column<DateOnly>(type: "date", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_crop_cycles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "daily_logs",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    operator_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    log_date = table.Column<DateOnly>(type: "date", nullable: false),
                    idempotency_key = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_daily_logs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "farms",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farms", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "finance_corrections",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    cost_entry_id = table.Column<Guid>(type: "uuid", nullable: false),
                    original_amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    corrected_amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    currency_code = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    reason = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    corrected_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    corrected_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_corrections", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "planned_activities",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: false),
                    activity_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    stage = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    planned_date = table.Column<DateOnly>(type: "date", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_planned_activities", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "plots",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    area_in_acres = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_plots", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "price_configs",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    item_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    unit_price = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    currency_code = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    effective_from = table.Column<DateOnly>(type: "date", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_price_configs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "schedule_templates",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    stage = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_templates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "sync_mutations",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    device_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    client_request_id = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    mutation_type = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    response_payload_json = table.Column<string>(type: "text", nullable: false),
                    processed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sync_mutations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "log_tasks",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    activity_type = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_log_tasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_log_tasks_daily_logs_daily_log_id",
                        column: x => x.daily_log_id,
                        principalSchema: "ssf",
                        principalTable: "daily_logs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "verification_events",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    daily_log_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    reason = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    verified_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verification_events", x => x.Id);
                    table.ForeignKey(
                        name: "FK_verification_events_daily_logs_daily_log_id",
                        column: x => x.daily_log_id,
                        principalSchema: "ssf",
                        principalTable: "daily_logs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "template_activities",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    activity_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    offset_days = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_template_activities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_template_activities_schedule_templates_schedule_template_id",
                        column: x => x.schedule_template_id,
                        principalSchema: "ssf",
                        principalTable: "schedule_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_events_actor_user_id",
                schema: "ssf",
                table: "audit_events",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_audit_events_entity_type_entity_id",
                schema: "ssf",
                table: "audit_events",
                columns: new[] { "entity_type", "entity_id" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_events_farm_id_occurred_at_utc",
                schema: "ssf",
                table: "audit_events",
                columns: new[] { "farm_id", "occurred_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_events_occurred_at_utc",
                schema: "ssf",
                table: "audit_events",
                column: "occurred_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_cost_entries_entry_date_farm_id",
                schema: "ssf",
                table: "cost_entries",
                columns: new[] { "entry_date", "farm_id" });

            migrationBuilder.CreateIndex(
                name: "IX_crop_cycles_farm_id_plot_id_start_date",
                schema: "ssf",
                table: "crop_cycles",
                columns: new[] { "farm_id", "plot_id", "start_date" });

            migrationBuilder.CreateIndex(
                name: "IX_daily_logs_idempotency_key",
                schema: "ssf",
                table: "daily_logs",
                column: "idempotency_key",
                unique: true,
                filter: "idempotency_key IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_finance_corrections_cost_entry_id_corrected_at_utc",
                schema: "ssf",
                table: "finance_corrections",
                columns: new[] { "cost_entry_id", "corrected_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_log_tasks_daily_log_id_occurred_at_utc",
                schema: "ssf",
                table: "log_tasks",
                columns: new[] { "daily_log_id", "occurred_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_planned_activities_crop_cycle_id_planned_date",
                schema: "ssf",
                table: "planned_activities",
                columns: new[] { "crop_cycle_id", "planned_date" });

            migrationBuilder.CreateIndex(
                name: "IX_plots_farm_id_name",
                schema: "ssf",
                table: "plots",
                columns: new[] { "farm_id", "name" });

            migrationBuilder.CreateIndex(
                name: "IX_price_configs_item_name_version",
                schema: "ssf",
                table: "price_configs",
                columns: new[] { "item_name", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sync_mutations_device_id_client_request_id",
                schema: "ssf",
                table: "sync_mutations",
                columns: new[] { "device_id", "client_request_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_template_activities_schedule_template_id",
                schema: "ssf",
                table: "template_activities",
                column: "schedule_template_id");

            migrationBuilder.CreateIndex(
                name: "IX_verification_events_daily_log_id_occurred_at_utc",
                schema: "ssf",
                table: "verification_events",
                columns: new[] { "daily_log_id", "occurred_at_utc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_events",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "cost_entries",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "crop_cycles",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "farms",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "finance_corrections",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "log_tasks",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "planned_activities",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "plots",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "price_configs",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "sync_mutations",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "template_activities",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "verification_events",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "schedule_templates",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "daily_logs",
                schema: "ssf");
        }
    }
}
