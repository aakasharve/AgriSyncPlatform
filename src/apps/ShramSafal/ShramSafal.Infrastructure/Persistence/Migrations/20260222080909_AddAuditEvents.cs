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
            migrationBuilder.Sql(
"""
CREATE SCHEMA IF NOT EXISTS ssf;

CREATE TABLE IF NOT EXISTS ssf.audit_events (
    "Id" uuid PRIMARY KEY,
    farm_id uuid NULL,
    entity_type character varying(80) NOT NULL,
    entity_id uuid NOT NULL,
    action character varying(80) NOT NULL,
    actor_user_id uuid NOT NULL,
    actor_role character varying(80) NOT NULL,
    payload text NOT NULL,
    occurred_at_utc timestamp with time zone NOT NULL,
    client_command_id character varying(150) NULL
);

CREATE TABLE IF NOT EXISTS ssf.cost_entries (
    "Id" uuid PRIMARY KEY,
    farm_id uuid NOT NULL,
    plot_id uuid NULL,
    crop_cycle_id uuid NULL,
    category character varying(80) NOT NULL,
    description character varying(500) NOT NULL,
    amount numeric(18,2) NOT NULL,
    currency_code character varying(8) NOT NULL,
    entry_date date NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at_utc timestamp with time zone NOT NULL,
    is_corrected boolean NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS ssf.crop_cycles (
    "Id" uuid PRIMARY KEY,
    farm_id uuid NOT NULL,
    plot_id uuid NOT NULL,
    crop_name character varying(120) NOT NULL,
    stage character varying(80) NOT NULL,
    start_date date NOT NULL,
    end_date date NULL,
    created_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.daily_logs (
    "Id" uuid PRIMARY KEY,
    farm_id uuid NOT NULL,
    plot_id uuid NOT NULL,
    crop_cycle_id uuid NOT NULL,
    operator_user_id uuid NOT NULL,
    log_date date NOT NULL,
    idempotency_key character varying(150) NULL,
    created_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.farms (
    "Id" uuid PRIMARY KEY,
    name character varying(120) NOT NULL,
    owner_user_id uuid NOT NULL,
    created_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.finance_corrections (
    "Id" uuid PRIMARY KEY,
    cost_entry_id uuid NOT NULL,
    original_amount numeric(18,2) NOT NULL,
    corrected_amount numeric(18,2) NOT NULL,
    currency_code character varying(8) NOT NULL,
    reason character varying(400) NOT NULL,
    corrected_by_user_id uuid NOT NULL,
    corrected_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.planned_activities (
    "Id" uuid PRIMARY KEY,
    crop_cycle_id uuid NOT NULL,
    activity_name character varying(120) NOT NULL,
    stage character varying(80) NOT NULL,
    planned_date date NOT NULL,
    created_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.plots (
    "Id" uuid PRIMARY KEY,
    farm_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    area_in_acres numeric(18,2) NOT NULL,
    created_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.price_configs (
    "Id" uuid PRIMARY KEY,
    item_name character varying(120) NOT NULL,
    unit_price numeric(18,2) NOT NULL,
    currency_code character varying(8) NOT NULL,
    effective_from date NOT NULL,
    version integer NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.schedule_templates (
    "Id" uuid PRIMARY KEY,
    name character varying(120) NOT NULL,
    stage character varying(80) NOT NULL,
    created_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.sync_mutations (
    "Id" uuid PRIMARY KEY,
    device_id character varying(120) NOT NULL,
    client_request_id character varying(150) NOT NULL,
    mutation_type character varying(80) NOT NULL,
    response_payload_json text NOT NULL,
    processed_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.log_tasks (
    "Id" uuid PRIMARY KEY,
    daily_log_id uuid NOT NULL,
    activity_type character varying(120) NOT NULL,
    notes character varying(500) NULL,
    occurred_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.verification_events (
    "Id" uuid PRIMARY KEY,
    daily_log_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    reason character varying(400) NULL,
    verified_by_user_id uuid NOT NULL,
    occurred_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.template_activities (
    "Id" uuid PRIMARY KEY,
    schedule_template_id uuid NOT NULL,
    activity_name character varying(120) NOT NULL,
    offset_days integer NOT NULL
);

DO $$
DECLARE
    daily_logs_pk text;
    schedule_templates_pk text;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ssf'
          AND table_name = 'daily_logs'
          AND column_name = 'Id'
    ) THEN
        daily_logs_pk := '"Id"';
    ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ssf'
          AND table_name = 'daily_logs'
          AND column_name = 'id'
    ) THEN
        daily_logs_pk := 'id';
    ELSE
        daily_logs_pk := NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ssf'
          AND table_name = 'schedule_templates'
          AND column_name = 'Id'
    ) THEN
        schedule_templates_pk := '"Id"';
    ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ssf'
          AND table_name = 'schedule_templates'
          AND column_name = 'id'
    ) THEN
        schedule_templates_pk := 'id';
    ELSE
        schedule_templates_pk := NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_log_tasks_daily_logs_daily_log_id'
          AND connamespace = 'ssf'::regnamespace
    ) AND daily_logs_pk IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE ssf.log_tasks
                ADD CONSTRAINT fk_log_tasks_daily_logs_daily_log_id
                FOREIGN KEY (daily_log_id)
                REFERENCES ssf.daily_logs(%s)
                ON DELETE CASCADE',
            daily_logs_pk);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_verification_events_daily_logs_daily_log_id'
          AND connamespace = 'ssf'::regnamespace
    ) AND daily_logs_pk IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE ssf.verification_events
                ADD CONSTRAINT fk_verification_events_daily_logs_daily_log_id
                FOREIGN KEY (daily_log_id)
                REFERENCES ssf.daily_logs(%s)
                ON DELETE CASCADE',
            daily_logs_pk);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_template_activities_schedule_templates_schedule_template_id'
          AND connamespace = 'ssf'::regnamespace
    ) AND schedule_templates_pk IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE ssf.template_activities
                ADD CONSTRAINT fk_template_activities_schedule_templates_schedule_template_id
                FOREIGN KEY (schedule_template_id)
                REFERENCES ssf.schedule_templates(%s)
                ON DELETE CASCADE',
            schedule_templates_pk);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_audit_events_actor_user_id
    ON ssf.audit_events (actor_user_id);

CREATE INDEX IF NOT EXISTS ix_audit_events_entity_type_entity_id
    ON ssf.audit_events (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS ix_audit_events_farm_id_occurred_at_utc
    ON ssf.audit_events (farm_id, occurred_at_utc);

CREATE INDEX IF NOT EXISTS ix_audit_events_occurred_at_utc
    ON ssf.audit_events (occurred_at_utc);

CREATE INDEX IF NOT EXISTS ix_cost_entries_entry_date_farm_id
    ON ssf.cost_entries (entry_date, farm_id);

CREATE INDEX IF NOT EXISTS ix_crop_cycles_farm_id_plot_id_start_date
    ON ssf.crop_cycles (farm_id, plot_id, start_date);

CREATE UNIQUE INDEX IF NOT EXISTS ix_daily_logs_idempotency_key
    ON ssf.daily_logs (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_finance_corrections_cost_entry_id_corrected_at_utc
    ON ssf.finance_corrections (cost_entry_id, corrected_at_utc);

CREATE INDEX IF NOT EXISTS ix_log_tasks_daily_log_id_occurred_at_utc
    ON ssf.log_tasks (daily_log_id, occurred_at_utc);

CREATE INDEX IF NOT EXISTS ix_planned_activities_crop_cycle_id_planned_date
    ON ssf.planned_activities (crop_cycle_id, planned_date);

CREATE INDEX IF NOT EXISTS ix_plots_farm_id_name
    ON ssf.plots (farm_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS ix_price_configs_item_name_version
    ON ssf.price_configs (item_name, version);

CREATE UNIQUE INDEX IF NOT EXISTS ix_sync_mutations_device_id_client_request_id
    ON ssf.sync_mutations (device_id, client_request_id);

CREATE INDEX IF NOT EXISTS ix_template_activities_schedule_template_id
    ON ssf.template_activities (schedule_template_id);

CREATE INDEX IF NOT EXISTS ix_verification_events_daily_log_id_occurred_at_utc
    ON ssf.verification_events (daily_log_id, occurred_at_utc);
""");
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
