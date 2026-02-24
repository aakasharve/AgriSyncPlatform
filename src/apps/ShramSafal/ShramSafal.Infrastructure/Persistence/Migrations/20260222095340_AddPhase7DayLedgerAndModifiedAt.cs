using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPhase7DayLedgerAndModifiedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
"""
CREATE SCHEMA IF NOT EXISTS ssf;

ALTER TABLE ssf.price_configs
    ADD COLUMN IF NOT EXISTS modified_at_utc timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '0001-01-01 00:00:00+00';
ALTER TABLE ssf.plots
    ADD COLUMN IF NOT EXISTS modified_at_utc timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '0001-01-01 00:00:00+00';
ALTER TABLE ssf.planned_activities
    ADD COLUMN IF NOT EXISTS modified_at_utc timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '0001-01-01 00:00:00+00';
ALTER TABLE ssf.finance_corrections
    ADD COLUMN IF NOT EXISTS modified_at_utc timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '0001-01-01 00:00:00+00';
ALTER TABLE ssf.farms
    ADD COLUMN IF NOT EXISTS modified_at_utc timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '0001-01-01 00:00:00+00';

ALTER TABLE ssf.daily_logs
    ADD COLUMN IF NOT EXISTS location_accuracy_meters numeric(10,2) NULL;
ALTER TABLE ssf.daily_logs
    ADD COLUMN IF NOT EXISTS location_altitude numeric(10,2) NULL;
ALTER TABLE ssf.daily_logs
    ADD COLUMN IF NOT EXISTS location_captured_at_utc timestamp with time zone NULL;
ALTER TABLE ssf.daily_logs
    ADD COLUMN IF NOT EXISTS location_latitude numeric(10,7) NULL;
ALTER TABLE ssf.daily_logs
    ADD COLUMN IF NOT EXISTS location_longitude numeric(10,7) NULL;
ALTER TABLE ssf.daily_logs
    ADD COLUMN IF NOT EXISTS location_permission_state character varying(30) NULL;
ALTER TABLE ssf.daily_logs
    ADD COLUMN IF NOT EXISTS location_provider character varying(50) NULL;
ALTER TABLE ssf.daily_logs
    ADD COLUMN IF NOT EXISTS modified_at_utc timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '0001-01-01 00:00:00+00';

ALTER TABLE ssf.crop_cycles
    ADD COLUMN IF NOT EXISTS modified_at_utc timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '0001-01-01 00:00:00+00';

ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS location_accuracy_meters numeric(10,2) NULL;
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS location_altitude numeric(10,2) NULL;
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS location_captured_at_utc timestamp with time zone NULL;
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS location_latitude numeric(10,7) NULL;
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS location_longitude numeric(10,7) NULL;
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS location_permission_state character varying(30) NULL;
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS location_provider character varying(50) NULL;
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS modified_at_utc timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '0001-01-01 00:00:00+00';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'ssf'
          AND table_name = 'day_ledgers'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ssf'
          AND table_name = 'day_ledgers'
          AND column_name = 'date_key'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'ssf'
              AND table_name = 'day_ledgers_legacy_financev2'
        ) THEN
            ALTER TABLE ssf.day_ledgers RENAME TO day_ledgers_legacy_financev2;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'ssf'
          AND table_name = 'day_ledger_plot_allocations'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'ssf'
              AND table_name = 'day_ledger_plot_allocations_legacy_financev2'
        ) THEN
            ALTER TABLE ssf.day_ledger_plot_allocations RENAME TO day_ledger_plot_allocations_legacy_financev2;
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS ssf.day_ledgers (
    "Id" uuid PRIMARY KEY,
    farm_id uuid NOT NULL,
    source_cost_entry_id uuid NOT NULL,
    ledger_date date NOT NULL,
    allocation_basis character varying(40) NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at_utc timestamp with time zone NOT NULL,
    modified_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.day_ledger_allocations (
    id uuid PRIMARY KEY,
    plot_id uuid NOT NULL,
    allocated_amount numeric(18,2) NOT NULL,
    currency_code character varying(8) NOT NULL,
    allocated_at_utc timestamp with time zone NOT NULL,
    day_ledger_id uuid NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_day_ledger_allocations_day_ledgers_day_ledger_id'
          AND connamespace = 'ssf'::regnamespace
    ) THEN
        ALTER TABLE ssf.day_ledger_allocations
            ADD CONSTRAINT fk_day_ledger_allocations_day_ledgers_day_ledger_id
            FOREIGN KEY (day_ledger_id)
            REFERENCES ssf.day_ledgers("Id")
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_price_configs_modified_at_utc
    ON ssf.price_configs (modified_at_utc);
CREATE INDEX IF NOT EXISTS ix_plots_modified_at_utc
    ON ssf.plots (modified_at_utc);
CREATE INDEX IF NOT EXISTS ix_planned_activities_modified_at_utc
    ON ssf.planned_activities (modified_at_utc);
CREATE INDEX IF NOT EXISTS ix_finance_corrections_modified_at_utc
    ON ssf.finance_corrections (modified_at_utc);
CREATE INDEX IF NOT EXISTS ix_farms_modified_at_utc
    ON ssf.farms (modified_at_utc);
CREATE INDEX IF NOT EXISTS ix_daily_logs_modified_at_utc
    ON ssf.daily_logs (modified_at_utc);
CREATE INDEX IF NOT EXISTS ix_crop_cycles_modified_at_utc
    ON ssf.crop_cycles (modified_at_utc);
CREATE INDEX IF NOT EXISTS ix_cost_entries_modified_at_utc
    ON ssf.cost_entries (modified_at_utc);

CREATE INDEX IF NOT EXISTS ix_day_ledger_allocations_allocated_at_utc
    ON ssf.day_ledger_allocations (allocated_at_utc);
CREATE INDEX IF NOT EXISTS ix_day_ledger_allocations_day_ledger_id
    ON ssf.day_ledger_allocations (day_ledger_id);
CREATE INDEX IF NOT EXISTS ix_day_ledger_allocations_plot_id
    ON ssf.day_ledger_allocations (plot_id);
CREATE INDEX IF NOT EXISTS ix_day_ledgers_farm_id_ledger_date
    ON ssf.day_ledgers (farm_id, ledger_date);
CREATE INDEX IF NOT EXISTS ix_day_ledgers_modified_at_utc
    ON ssf.day_ledgers (modified_at_utc);
CREATE UNIQUE INDEX IF NOT EXISTS ix_day_ledgers_source_cost_entry_id
    ON ssf.day_ledgers (source_cost_entry_id);
""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "day_ledger_allocations",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "day_ledgers",
                schema: "ssf");

            migrationBuilder.DropIndex(
                name: "IX_price_configs_modified_at_utc",
                schema: "ssf",
                table: "price_configs");

            migrationBuilder.DropIndex(
                name: "IX_plots_modified_at_utc",
                schema: "ssf",
                table: "plots");

            migrationBuilder.DropIndex(
                name: "IX_planned_activities_modified_at_utc",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropIndex(
                name: "IX_finance_corrections_modified_at_utc",
                schema: "ssf",
                table: "finance_corrections");

            migrationBuilder.DropIndex(
                name: "IX_farms_modified_at_utc",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropIndex(
                name: "IX_daily_logs_modified_at_utc",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropIndex(
                name: "IX_crop_cycles_modified_at_utc",
                schema: "ssf",
                table: "crop_cycles");

            migrationBuilder.DropIndex(
                name: "IX_cost_entries_modified_at_utc",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "price_configs");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "plots");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "planned_activities");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "finance_corrections");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "location_accuracy_meters",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_altitude",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_captured_at_utc",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_latitude",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_longitude",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_permission_state",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "location_provider",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "crop_cycles");

            migrationBuilder.DropColumn(
                name: "location_accuracy_meters",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_altitude",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_captured_at_utc",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_latitude",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_longitude",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_permission_state",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "location_provider",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "modified_at_utc",
                schema: "ssf",
                table: "cost_entries");
        }
    }
}
