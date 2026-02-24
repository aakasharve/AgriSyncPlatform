using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAiOrchestration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
"""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ssf'
          AND table_name = 'verification_events'
          AND column_name = 'status'
    ) THEN
        ALTER TABLE ssf.verification_events
            ALTER COLUMN status TYPE character varying(40);
    END IF;
END $$;

ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS flag_reason character varying(300);
ALTER TABLE ssf.cost_entries
    ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ssf.ai_jobs (
    id uuid PRIMARY KEY,
    idempotency_key character varying(256) NOT NULL,
    operation_type character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    farm_id uuid NOT NULL,
    status character varying(64) NOT NULL,
    input_content_hash character varying(128) NULL,
    input_storage_path character varying(1024) NULL,
    normalized_result_json jsonb NULL,
    input_speech_duration_ms integer NULL,
    input_raw_duration_ms integer NULL,
    schema_version character varying(32) NOT NULL,
    created_at_utc timestamp with time zone NOT NULL,
    completed_at_utc timestamp with time zone NULL,
    total_attempts integer NOT NULL,
    modified_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.ai_provider_configs (
    id uuid PRIMARY KEY,
    default_provider character varying(64) NOT NULL,
    fallback_enabled boolean NOT NULL,
    is_ai_processing_disabled boolean NOT NULL,
    max_retries integer NOT NULL,
    circuit_breaker_threshold integer NOT NULL,
    circuit_breaker_reset_seconds integer NOT NULL,
    voice_confidence_threshold numeric(5,4) NOT NULL,
    receipt_confidence_threshold numeric(5,4) NOT NULL,
    modified_at_utc timestamp with time zone NOT NULL,
    modified_by_user_id uuid NOT NULL,
    voice_provider character varying(64) NULL,
    receipt_provider character varying(64) NULL,
    patti_provider character varying(64) NULL
);

CREATE TABLE IF NOT EXISTS ssf.ai_job_attempts (
    id uuid PRIMARY KEY,
    ai_job_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    provider character varying(64) NOT NULL,
    is_success boolean NOT NULL,
    failure_class character varying(64) NOT NULL,
    error_message character varying(2048) NULL,
    raw_provider_response text NULL,
    latency_ms integer NOT NULL,
    tokens_used integer NULL,
    confidence_score numeric(5,4) NULL,
    estimated_cost_units numeric(10,4) NULL,
    attempted_at_utc timestamp with time zone NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_ai_job_attempts_ai_jobs_ai_job_id'
          AND connamespace = 'ssf'::regnamespace
    ) THEN
        ALTER TABLE ssf.ai_job_attempts
            ADD CONSTRAINT fk_ai_job_attempts_ai_jobs_ai_job_id
            FOREIGN KEY (ai_job_id)
            REFERENCES ssf.ai_jobs(id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ai_job_attempts_ai_job_id
    ON ssf.ai_job_attempts (ai_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_ai_job_attempts_ai_job_id_attempt_number
    ON ssf.ai_job_attempts (ai_job_id, attempt_number);
CREATE INDEX IF NOT EXISTS ix_ai_job_attempts_attempted_at_utc
    ON ssf.ai_job_attempts (attempted_at_utc);
CREATE INDEX IF NOT EXISTS ix_ai_job_attempts_provider
    ON ssf.ai_job_attempts (provider);

CREATE INDEX IF NOT EXISTS ix_ai_jobs_created_at_utc
    ON ssf.ai_jobs (created_at_utc);
CREATE INDEX IF NOT EXISTS ix_ai_jobs_farm_id
    ON ssf.ai_jobs (farm_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_ai_jobs_idempotency_key
    ON ssf.ai_jobs (idempotency_key);
CREATE INDEX IF NOT EXISTS ix_ai_jobs_status
    ON ssf.ai_jobs (status);
CREATE INDEX IF NOT EXISTS ix_ai_jobs_user_id
    ON ssf.ai_jobs (user_id);
""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_job_attempts",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "ai_provider_configs",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "ai_jobs",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "flag_reason",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "is_flagged",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.AlterColumn<string>(
                name: "status",
                schema: "ssf",
                table: "verification_events",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);
        }
    }
}
