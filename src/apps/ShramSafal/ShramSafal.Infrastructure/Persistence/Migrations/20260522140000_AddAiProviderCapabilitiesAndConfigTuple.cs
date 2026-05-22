using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.2 — additive
    /// schema for the voice-pipeline split: adds four tuple columns to
    /// <c>ssf.ai_provider_configs</c> (transcriber/structurer/translator
    /// provider names + Sarvam STT mode), and creates the new
    /// <c>ssf.ai_provider_capabilities</c> matrix table seeded from
    /// <c>_COFOUNDER/Projects/AgriSync/Architecture/CAPABILITY_MATRIX.md</c>.
    /// All four new <c>ai_provider_configs</c> columns are nullable or
    /// defaulted so existing rows continue to work unchanged.
    /// </summary>
    /// <remarks>
    /// Per the plan supervisor's note: cost fields
    /// (<c>cost_per_unit_inr</c> + <c>cost_unit</c>) are intentionally
    /// seeded as <c>NULL</c>; the cost guardrail in Plan Task 2.7
    /// populates them at runtime from observed vendor billing. The
    /// <c>sla_ttft_ms</c> values come from vendor-published Saaras V3 +
    /// Gemini latency docs and are stored as plain integers.
    /// Diarization is intentionally NOT a Sarvam mode (per founder
    /// blocker #4); it lives in <c>ssf.diarization_policy</c> created by
    /// Plan Task 1.5a.
    /// </remarks>
    public partial class AddAiProviderCapabilitiesAndConfigTuple : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "structurer_provider",
                schema: "ssf",
                table: "ai_provider_configs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "Gemini");

            migrationBuilder.AddColumn<string>(
                name: "transcriber_mode",
                schema: "ssf",
                table: "ai_provider_configs",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "transcriber_provider",
                schema: "ssf",
                table: "ai_provider_configs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "Gemini");

            migrationBuilder.AddColumn<string>(
                name: "translator_provider",
                schema: "ssf",
                table: "ai_provider_configs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ai_provider_capabilities",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    operation = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    supports_streaming = table.Column<bool>(type: "boolean", nullable: false),
                    max_audio_seconds = table.Column<int>(type: "integer", nullable: true),
                    cost_per_unit_inr = table.Column<decimal>(type: "numeric(10,4)", precision: 10, scale: 4, nullable: true),
                    cost_unit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    sla_ttft_ms = table.Column<int>(type: "integer", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_provider_capabilities", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_ai_provider_capabilities_provider_operation_mode",
                schema: "ssf",
                table: "ai_provider_capabilities",
                columns: new[] { "provider", "operation", "mode" },
                unique: true);

            // Seed: rows derive from CAPABILITY_MATRIX.md "Provider ×
            // Operation matrix" + "Per-operation pricing reference".
            // Deterministic GUIDs make this idempotent across local,
            // CI, and prod. Cost columns left NULL per supervisor
            // guidance — Plan Task 2.7 populates from runtime billing.
            migrationBuilder.Sql(
                """
                INSERT INTO ssf.ai_provider_capabilities
                    (id, provider, operation, mode, supports_streaming,
                     max_audio_seconds, cost_per_unit_inr, cost_unit, sla_ttft_ms,
                     is_active, created_at_utc, modified_at_utc)
                VALUES
                    -- Sarvam Saaras V3 codemix (live primary post-Phase 2.13)
                    ('00000000-0000-0000-0001-000000000001',
                     'Sarvam', 'VoiceToStructuredLog', 'codemix',
                     TRUE, NULL, NULL, NULL, 150,
                     TRUE, TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    -- Sarvam Saaras V3 verbatim (10% sampled training corpus, REST batch)
                    ('00000000-0000-0000-0001-000000000002',
                     'Sarvam', 'VoiceToStructuredLog', 'verbatim',
                     FALSE, NULL, NULL, NULL, NULL,
                     TRUE, TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    -- Gemini 2.5 Flash multimodal (voice fallback)
                    ('00000000-0000-0000-0001-000000000003',
                     'Gemini', 'VoiceToStructuredLog', NULL,
                     TRUE, NULL, NULL, NULL, 1000,
                     TRUE, TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    -- Gemini 2.5 Flash multimodal (Receipt OCR, primary locked)
                    ('00000000-0000-0000-0001-000000000004',
                     'Gemini', 'ReceiptToExpenseItems', NULL,
                     FALSE, NULL, NULL, NULL, NULL,
                     TRUE, TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    -- Gemini 2.5 Flash multimodal (Patti OCR, primary locked)
                    ('00000000-0000-0000-0001-000000000005',
                     'Gemini', 'PattiImageToSaleData', NULL,
                     FALSE, NULL, NULL, NULL, NULL,
                     TRUE, TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z'),
                    -- Gemini 3.1 Flash-Lite Preview (text-only voice transcription / structurer)
                    ('00000000-0000-0000-0001-000000000006',
                     'Gemini', 'VoiceTranscription', NULL,
                     TRUE, NULL, NULL, NULL, 300,
                     TRUE, TIMESTAMPTZ '2026-05-22 00:00:00Z', TIMESTAMPTZ '2026-05-22 00:00:00Z');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_provider_capabilities",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "structurer_provider",
                schema: "ssf",
                table: "ai_provider_configs");

            migrationBuilder.DropColumn(
                name: "transcriber_mode",
                schema: "ssf",
                table: "ai_provider_configs");

            migrationBuilder.DropColumn(
                name: "transcriber_provider",
                schema: "ssf",
                table: "ai_provider_configs");

            migrationBuilder.DropColumn(
                name: "translator_provider",
                schema: "ssf",
                table: "ai_provider_configs");
        }
    }
}
