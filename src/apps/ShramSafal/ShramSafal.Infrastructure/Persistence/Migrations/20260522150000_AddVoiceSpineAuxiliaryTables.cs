using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Tasks 1.3 + 1.4 + 1.5 +
    /// 1.5a + 1.6 — bundled auxiliary-schema migration for the voice
    /// spine. Adds four new global lookup tables (<c>transcript_history</c>,
    /// <c>feature_flags</c>, <c>mode_policy</c>, <c>diarization_policy</c>)
    /// and the forward-compat <c>evidence_sources</c> jsonb column on
    /// <c>ssf.daily_logs</c> per ADR-DS-015 §C.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Timestamp.</b> Auto-generated <c>20260522064007</c> was lower
    /// than Phase 1.2's <c>20260522140000</c>; manually renamed to
    /// <c>20260522150000</c> so the natural chronological order in
    /// EF's history matches the apply order.
    /// </para>
    /// <para>
    /// <b>Seed-row policy.</b>
    /// <list type="bullet">
    /// <item><c>transcript_history</c>: no seeds — pure audit ledger.</item>
    /// <item><c>feature_flags</c>: 3 seeds, all <c>enabled=false</c>,
    /// deterministic GUIDs <c>00000000-0000-0000-0002-00000000000{1..3}</c>.</item>
    /// <item><c>mode_policy</c>: 4 seeds per ADR-DS-016 §Population
    /// strategy, deterministic GUIDs <c>00000000-0000-0000-0003-00000000000{1..4}</c>.
    /// <b>Founder blocker #4</b>: <c>modes_to_run</c> NEVER carries
    /// <c>diarized</c> / <c>diarization</c> — diarization is modeled in
    /// the sibling <c>diarization_policy</c> table.</item>
    /// <item><c>diarization_policy</c>: 3 seeds, deterministic GUIDs
    /// <c>00000000-0000-0000-0004-00000000000{1..3}</c>.</item>
    /// </list>
    /// </para>
    /// <para>
    /// <b>RLS posture.</b> All four new tables are global operational
    /// lookups with no farm dimension; each is added to the explicit
    /// <c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c> set in
    /// the same envelope so the architecture test stays green. The
    /// modified <c>daily_logs</c> table already has RLS — adding a
    /// column doesn't change that.
    /// </para>
    /// </remarks>
    public partial class AddVoiceSpineAuxiliaryTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1) transcript_history — Task 1.3 (Safeguard S4)
            migrationBuilder.CreateTable(
                name: "transcript_history",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    audio_content_hash = table.Column<string>(type: "char(64)", maxLength: 64, nullable: false),
                    transcript_provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    transcript_model_version = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    transcript_mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    transcript_text = table.Column<string>(type: "text", nullable: false),
                    prompt_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    extractor_code_sha = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    produced_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_transcript_history", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_transcript_history_audio_content_hash",
                schema: "ssf",
                table: "transcript_history",
                column: "audio_content_hash");

            migrationBuilder.CreateIndex(
                name: "ix_transcript_history_provider_version",
                schema: "ssf",
                table: "transcript_history",
                columns: new[] { "transcript_provider", "transcript_model_version" });

            migrationBuilder.CreateIndex(
                name: "ux_transcript_history_audio_provider_model_mode",
                schema: "ssf",
                table: "transcript_history",
                columns: new[] { "audio_content_hash", "transcript_provider", "transcript_model_version", "transcript_mode" },
                unique: true);

            // 2) feature_flags — Task 1.4 (Safeguard S7)
            migrationBuilder.CreateTable(
                name: "feature_flags",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    flag_name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    cohort_pattern = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    description = table.Column<string>(type: "text", nullable: true),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_by = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_feature_flags", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_feature_flags_flag_name",
                schema: "ssf",
                table: "feature_flags",
                column: "flag_name",
                unique: true);

            // Seed: 3 cohort-gate flags, all disabled until rollout time.
            // Deterministic GUIDs keep the seed idempotent across local /
            // CI / prod.
            migrationBuilder.Sql(
                """
                INSERT INTO ssf.feature_flags
                    (id, flag_name, enabled, cohort_pattern, description,
                     modified_at_utc, modified_by)
                VALUES
                    ('00000000-0000-0000-0002-000000000001',
                     'voice_provider_sarvam_cohort', FALSE, NULL,
                     'Cohort gate for routing voice to Sarvam (Phase 2.13 staged rollout founder -> 5 -> 50 -> all)',
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', 'system-seed'),
                    ('00000000-0000-0000-0002-000000000002',
                     'verbatim_corpus_sampling_enabled', FALSE, NULL,
                     'Enables D-MOAT verbatim sample worker (Phase 2.11; 10% deterministic hash x 80% consent)',
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', 'system-seed'),
                    ('00000000-0000-0000-0002-000000000003',
                     'selective_diarization_on_dispute', FALSE, NULL,
                     'Enables Sarvam diarization on Trust-Ladder DISPUTED clips (Phase 2.11a)',
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', 'system-seed');
                """);

            // 3) mode_policy — Task 1.5 (ADR-DS-016)
            migrationBuilder.CreateTable(
                name: "mode_policy",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    trigger_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    modes_to_run = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    priority = table.Column<int>(type: "integer", nullable: false),
                    max_daily_cost_inr = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    applies_to_event_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mode_policy", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_mode_policy_trigger_type",
                schema: "ssf",
                table: "mode_policy",
                column: "trigger_type");

            // Seed: 4 default policy rows per ADR-DS-016 Population
            // strategy. CRITICAL (founder blocker #4): modes_to_run only
            // contains valid Sarvam STT modes (codemix | verbatim |
            // translit | translate | transcribe). Diarization lives in
            // ssf.diarization_policy below.
            migrationBuilder.Sql(
                """
                INSERT INTO ssf.mode_policy
                    (id, trigger_type, modes_to_run, priority,
                     max_daily_cost_inr, applies_to_event_type, enabled,
                     created_at_utc, modified_at_utc)
                VALUES
                    ('00000000-0000-0000-0003-000000000001',
                     'normal_daily_log', 'codemix', 10,
                     NULL, NULL, TRUE,
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    ('00000000-0000-0000-0003-000000000002',
                     'verbatim_sample', 'verbatim', 20,
                     100, NULL, TRUE,
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    ('00000000-0000-0000-0003-000000000003',
                     'dispute_flagged', 'verbatim', 30,
                     500, NULL, TRUE,
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    ('00000000-0000-0000-0003-000000000004',
                     'low_confidence', 'verbatim', 40,
                     50, NULL, TRUE,
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z');
                """);

            // 4) diarization_policy — Task 1.5a (founder blocker #4)
            migrationBuilder.CreateTable(
                name: "diarization_policy",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    trigger_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    max_daily_cost_inr = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    applies_to_event_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_diarization_policy", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_diarization_policy_trigger_type",
                schema: "ssf",
                table: "diarization_policy",
                column: "trigger_type",
                unique: true);

            // Seed: 3 diarization-capability rows. Founder-manual + dispute
            // start enabled (with a 500 INR/day cap on dispute);
            // high_risk_clip ships disabled awaiting the risk-scoring
            // worker that activates it.
            migrationBuilder.Sql(
                """
                INSERT INTO ssf.diarization_policy
                    (id, trigger_type, enabled, max_daily_cost_inr,
                     applies_to_event_type, created_at_utc, modified_at_utc)
                VALUES
                    ('00000000-0000-0000-0004-000000000001',
                     'dispute_flagged', TRUE, 500, NULL,
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    ('00000000-0000-0000-0004-000000000002',
                     'high_risk_clip', FALSE, NULL, NULL,
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    ('00000000-0000-0000-0004-000000000003',
                     'founder_manual', TRUE, NULL, NULL,
                     TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z');
                """);

            // 5) daily_logs.evidence_sources — Task 1.6 (ADR-DS-015 §C
            //    forward-compat seam). NOT NULL with default '[]'::jsonb
            //    so legacy rows backfill deterministically; per ADR-DS-015
            //    the column describes immutable facts only (no mutable
            //    state) so the future event-sourced migration is
            //    non-destructive. The Application-layer m2m consumer is
            //    deferred to a future spec.
            migrationBuilder.AddColumn<string>(
                name: "evidence_sources",
                schema: "ssf",
                table: "daily_logs",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'[]'::jsonb");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reverse order so foreign-key / dependency ordering is
            // symmetric with Up().
            migrationBuilder.DropColumn(
                name: "evidence_sources",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropTable(
                name: "diarization_policy",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "mode_policy",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "feature_flags",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "transcript_history",
                schema: "ssf");
        }
    }
}
