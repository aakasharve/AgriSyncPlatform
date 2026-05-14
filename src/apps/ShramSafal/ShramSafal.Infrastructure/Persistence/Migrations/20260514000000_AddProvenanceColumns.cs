// spec: data-principle-spine-2026-05-05
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Phase 01 sub-phase 01.3 of the Data Principle Spine.
    /// Adds the five-field <c>Provenance</c> owned record (source,
    /// model_version, prompt_version, prompt_content_hash, app_version) to
    /// <c>ssf.daily_logs</c>, <c>ssf.cost_entries</c>, <c>ssf.ai_jobs</c>
    /// (and <c>ssf.ai_job_attempts</c> for EF model parity). Also adds the
    /// nullable <c>source_ai_job_id</c> lineage column to <c>daily_logs</c>
    /// and <c>cost_entries</c>, and renames <c>ai_jobs.input_storage_path</c>
    /// to <c>raw_input_ref</c> via drop-and-add-with-backfill.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Ordering.</b> Strict 8-step ordering per the senior-architect brief:
    /// (1) nullable AddColumn for provenance fields on the three primary
    /// tables, (2) nullable AddColumn for source_ai_job_id, (3) nullable
    /// AddColumn for raw_input_ref, (4) backfill raw_input_ref from
    /// input_storage_path — load-bearing, preserves S3 paths, (5) backfill
    /// provenance per honesty rule: pre-spine rows are stamped 'pre_spine'
    /// with 'unknown' model/prompt; voice ai_jobs keep 'voice' as a small
    /// nicety, (6) drop input_storage_path, (7) AlterColumn to NOT NULL on
    /// source/model_version/prompt_version, (8) CreateIndex for
    /// (prompt_version, model_version), source_ai_job_id, and a partial
    /// index on raw_input_ref WHERE NOT NULL.
    /// </para>
    /// <para>
    /// <b>No FK on source_ai_job_id.</b> Per DPDP §12 erasure tolerance —
    /// AI jobs can be reaped without orphaning downstream rows.
    /// </para>
    /// <para>
    /// <b>Forward-only.</b> <see cref="Down"/> throws — production rollback
    /// is via snapshot restore per
    /// <c>_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md</c>; local-dev
    /// cleanup is via <c>dotnet ef database drop</c>.
    /// </para>
    /// </remarks>
    public partial class AddProvenanceColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ----------------------------------------------------------------
            // Step 1 - Nullable AddColumn for the five provenance fields on
            // each table. NOT NULL is applied after backfill in Step 7.
            // ----------------------------------------------------------------
            AddProvenanceColumnsNullable(migrationBuilder, "daily_logs");
            AddProvenanceColumnsNullable(migrationBuilder, "cost_entries");
            AddProvenanceColumnsNullable(migrationBuilder, "ai_jobs");
            AddProvenanceColumnsNullable(migrationBuilder, "ai_job_attempts");

            // ----------------------------------------------------------------
            // Step 2 - Nullable source_ai_job_id on daily_logs / cost_entries.
            // No FK constraint (DPDP §12 erasure tolerance).
            // ----------------------------------------------------------------
            migrationBuilder.AddColumn<Guid>(
                name: "source_ai_job_id",
                schema: "ssf",
                table: "daily_logs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "source_ai_job_id",
                schema: "ssf",
                table: "cost_entries",
                type: "uuid",
                nullable: true);

            // ----------------------------------------------------------------
            // Step 3 - Nullable raw_input_ref on ai_jobs (new name for the
            // existing input_storage_path column).
            // ----------------------------------------------------------------
            migrationBuilder.AddColumn<string>(
                name: "raw_input_ref",
                schema: "ssf",
                table: "ai_jobs",
                type: "character varying(1024)",
                maxLength: 1024,
                nullable: true);

            // ----------------------------------------------------------------
            // Step 4 - Backfill raw_input_ref = input_storage_path
            // (LOAD-BEARING: preserves existing S3 paths.)
            // ----------------------------------------------------------------
            migrationBuilder.Sql(@"
                UPDATE ssf.ai_jobs
                SET raw_input_ref = input_storage_path
                WHERE input_storage_path IS NOT NULL;
            ");

            // ----------------------------------------------------------------
            // Step 5 - Backfill provenance per the honesty rule. Existing
            // rows did not pass through the spine, so they get 'pre_spine'
            // with 'unknown' model/prompt - corpus queries exclude these.
            // For ai_jobs we make a small concession: voice operations keep
            // 'voice' as source so the existing voice corpus is still
            // discoverable; non-voice jobs are 'pre_spine'.
            // ----------------------------------------------------------------
            migrationBuilder.Sql(@"
                UPDATE ssf.daily_logs
                SET source = 'pre_spine',
                    model_version = 'unknown',
                    prompt_version = 'unknown'
                WHERE source IS NULL;
            ");

            migrationBuilder.Sql(@"
                UPDATE ssf.cost_entries
                SET source = 'pre_spine',
                    model_version = 'unknown',
                    prompt_version = 'unknown'
                WHERE source IS NULL;
            ");

            migrationBuilder.Sql(@"
                UPDATE ssf.ai_jobs
                SET source = CASE
                        WHEN operation_type ILIKE '%voice%' THEN 'voice'
                        ELSE 'pre_spine'
                    END,
                    model_version = 'unknown',
                    prompt_version = 'unknown'
                WHERE source IS NULL;
            ");

            migrationBuilder.Sql(@"
                UPDATE ssf.ai_job_attempts
                SET source = 'pre_spine',
                    model_version = 'unknown',
                    prompt_version = 'unknown'
                WHERE source IS NULL;
            ");

            // ----------------------------------------------------------------
            // Step 6 - Drop ai_jobs.input_storage_path now that
            // raw_input_ref carries the data.
            // ----------------------------------------------------------------
            migrationBuilder.DropColumn(
                name: "input_storage_path",
                schema: "ssf",
                table: "ai_jobs");

            // ----------------------------------------------------------------
            // Step 7 - Tighten source / model_version / prompt_version to
            // NOT NULL. prompt_content_hash and app_version stay nullable
            // (pre-spine and manual rows legitimately have none).
            // ----------------------------------------------------------------
            AlterProvenanceColumnsNotNull(migrationBuilder, "daily_logs");
            AlterProvenanceColumnsNotNull(migrationBuilder, "cost_entries");
            AlterProvenanceColumnsNotNull(migrationBuilder, "ai_jobs");
            AlterProvenanceColumnsNotNull(migrationBuilder, "ai_job_attempts");

            // ----------------------------------------------------------------
            // Step 8 - Indexes for A/B comparison + lineage lookup.
            // No index on source (six values, low cardinality).
            // ----------------------------------------------------------------
            migrationBuilder.CreateIndex(
                name: "ix_daily_logs_prompt_model",
                schema: "ssf",
                table: "daily_logs",
                columns: new[] { "prompt_version", "model_version" });

            migrationBuilder.CreateIndex(
                name: "ix_cost_entries_prompt_model",
                schema: "ssf",
                table: "cost_entries",
                columns: new[] { "prompt_version", "model_version" });

            migrationBuilder.CreateIndex(
                name: "ix_ai_jobs_prompt_model",
                schema: "ssf",
                table: "ai_jobs",
                columns: new[] { "prompt_version", "model_version" });

            migrationBuilder.CreateIndex(
                name: "ix_daily_logs_source_ai_job_id",
                schema: "ssf",
                table: "daily_logs",
                column: "source_ai_job_id");

            migrationBuilder.CreateIndex(
                name: "ix_cost_entries_source_ai_job_id",
                schema: "ssf",
                table: "cost_entries",
                column: "source_ai_job_id");

            migrationBuilder.CreateIndex(
                name: "ix_ai_jobs_raw_input_ref",
                schema: "ssf",
                table: "ai_jobs",
                column: "raw_input_ref",
                filter: "raw_input_ref IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new InvalidOperationException("This migration is forward-only.");
        }

        /// <summary>
        /// Adds the five provenance columns to a single table, all nullable.
        /// Tightened to NOT NULL by <see cref="AlterProvenanceColumnsNotNull"/>
        /// after the backfill phase.
        /// </summary>
        private static void AddProvenanceColumnsNullable(MigrationBuilder migrationBuilder, string table)
        {
            migrationBuilder.AddColumn<string>(
                name: "source",
                schema: "ssf",
                table: table,
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "model_version",
                schema: "ssf",
                table: table,
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "prompt_version",
                schema: "ssf",
                table: table,
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "prompt_content_hash",
                schema: "ssf",
                table: table,
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "app_version",
                schema: "ssf",
                table: table,
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);
        }

        /// <summary>
        /// Tightens <c>source</c>, <c>model_version</c>, <c>prompt_version</c>
        /// to NOT NULL after the Step 5 backfill. <c>prompt_content_hash</c>
        /// and <c>app_version</c> stay nullable.
        /// </summary>
        private static void AlterProvenanceColumnsNotNull(MigrationBuilder migrationBuilder, string table)
        {
            migrationBuilder.AlterColumn<string>(
                name: "source",
                schema: "ssf",
                table: table,
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "model_version",
                schema: "ssf",
                table: table,
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "prompt_version",
                schema: "ssf",
                table: table,
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);
        }
    }
}
