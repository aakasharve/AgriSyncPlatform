// spec: data-principle-spine-2026-05-05/05.5
// spec: data-principle-spine-2026-05-05/05.6
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 05 sub-phases 05.5 + 05.6 — single
    /// migration that ships the DPDP §8(2) DPA registry
    /// (<c>ssf.dpa_registry</c>) and the cross-border transfer audit log
    /// (<c>ssf.cross_border_transfers</c>) together.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why one migration for two sub-phases.</b> The envelope
    /// coordinator decided to keep both tables in the same migration so
    /// the coordinator can ship one ordered EF artefact. Splitting would
    /// either force two migrations (worse history) or trigger a rebase
    /// against a sibling envelope (worse still). Both tables are net-new
    /// — no cross-coupling with existing schema — so colocation is safe.
    /// </para>
    ///
    /// <para>
    /// <b>RLS exemption for <c>ssf.cross_border_transfers</c> (OQ-5).</b>
    /// Conflict-resolver verdict OQ-5 (2026-05-17) explicitly rejected
    /// enabling Row-Level Security on this table:
    /// <list type="bullet">
    /// <item><b>Read path is admin-only</b> — Phase 08 export bundle
    /// runs through <c>IAdminDbContextFactory&lt;ShramSafalDbContext&gt;</c>
    /// (no tenant claim) so an RLS policy keyed on
    /// <c>agrisync.farm_id</c> would always evaluate to NULL and
    /// filter out every row.</item>
    /// <item><b>Write path is system-only</b> — <c>GeminiAiProvider</c>
    /// inserts via the same admin factory, scoped to
    /// <c>SystemActor.CrossBorderLoggerUserId</c>. No tenant-scoped
    /// connection ever touches this table.</item>
    /// <item><b>Defence is at the grant boundary</b> —
    /// <c>agrisync_app</c> gets <c>SELECT, INSERT</c> only. No
    /// <c>UPDATE</c>, no <c>DELETE</c>. The audit log is append-only by
    /// privilege, not by policy.</item>
    /// </list>
    /// The companion architecture test
    /// (<c>RlsExemptionAllowlistTests</c>) enforces an explicit
    /// allowlist so any future no-RLS table must be added deliberately.
    /// See ADR-DS-004 §RLS-Exemptions.
    /// </para>
    ///
    /// <para>
    /// <b>DPA seed shape (OQ-4).</b> Three pending rows for AWS, Google
    /// Gemini, and Sarvam — all with <c>contract_path =
    /// 'PENDING_LEGAL_UPLOAD'</c>, <c>signed_date IS NULL</c>,
    /// <c>is_active = false</c>. The plan-body sketch used
    /// <c>DateOnly.Parse("1900-01-01")</c> as a sentinel; conflict-
    /// resolver rejected that hack in favour of nullable signed_date.
    /// Startup gap-warning in <c>Program.cs</c> queries
    /// <c>DpaRecords</c> for inactive rows and lists pending vendors —
    /// so the seed MUST land active=false or the warning falls silent
    /// at boot.
    /// </para>
    ///
    /// <para>
    /// <b>Deterministic seed Ids.</b> Each row uses a hand-rolled GUID
    /// (one digit different in the last segment) so a rerun of the
    /// migration in a fresh database produces identical IDs across
    /// environments. Easier debugging than <c>Guid.NewGuid()</c> would
    /// give us — migrations must be deterministic (the same Up() can be
    /// replayed by anyone).
    /// </para>
    ///
    /// <para>
    /// <b>Down() drops both tables.</b> No data preservation; the
    /// rollback story for cross-border telemetry is "the log is gone,
    /// re-instate the migration to start over". Production rollback is
    /// snapshot-restore per the plan's Rollback section.
    /// </para>
    /// </remarks>
    public partial class PrivacyEdge : Migration
    {
        // OQ-4 verdict — stable IDs so reruns in dev/CI don't churn the
        // seed PK every time. Each Guid is a sibling of the next (only
        // the last hex digit changes). Production environments stamp
        // their own seed via a separate runbook before flipping
        // is_active = true.
        private static readonly Guid SeedAwsId = new("ee000000-0000-0000-0000-00000000d9a1");
        private static readonly Guid SeedGeminiId = new("ee000000-0000-0000-0000-00000000d9a2");
        private static readonly Guid SeedSarvamId = new("ee000000-0000-0000-0000-00000000d9a3");

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. cross_border_transfers ─────────────────────────────
            // No RLS: admin-only read path (Phase 08), system-only write
            // path (GeminiAiProvider via IAdminDbContextFactory).
            // See ADR-DS-004 §RLS-Exemptions.
            migrationBuilder.CreateTable(
                name: "cross_border_transfers",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    destination_region = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    destination_vendor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    payload_class = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    source_ai_job_id = table.Column<Guid>(type: "uuid", nullable: true),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: true),
                    consent_token_kid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    payload_size_bytes = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cross_border_transfers", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_cross_border_transfers_occurred_destination",
                schema: "ssf",
                table: "cross_border_transfers",
                columns: new[] { "occurred_at_utc", "destination_region" });

            // ── 2. dpa_registry ───────────────────────────────────────
            migrationBuilder.CreateTable(
                name: "dpa_registry",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    vendor_name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    contract_path = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    signed_date = table.Column<DateOnly>(type: "date", nullable: true),
                    scope = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    region = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    contact_email = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dpa_registry", x => x.id);
                });

            // ── 3. Seed three pending DPA rows (OQ-4 verbatim) ──────────
            // PENDING_LEGAL_UPLOAD is the sentinel string Program.cs
            // matches against when surfacing the gap-warning. Do NOT
            // rewrite to fake PDF paths.
            migrationBuilder.InsertData(
                schema: "ssf",
                table: "dpa_registry",
                columns: new[]
                {
                    "id", "vendor_name", "contract_path", "signed_date",
                    "scope", "region", "contact_email", "is_active"
                },
                values: new object[,]
                {
                    {
                        SeedAwsId, "AWS", "PENDING_LEGAL_UPLOAD", null,
                        "S3, KMS, Secrets Manager, EC2", "ap-south-1",
                        "aws-india-privacy@amazon.com", false
                    },
                    {
                        SeedGeminiId, "Google_Gemini", "PENDING_LEGAL_UPLOAD", null,
                        "Voice transcript parsing", "us-central1",
                        "data-protection@google.com", false
                    },
                    {
                        SeedSarvamId, "Sarvam", "PENDING_LEGAL_UPLOAD", null,
                        "Marathi STT + chat fallback", "ap-south-1",
                        "privacy@sarvam.ai", false
                    },
                });

            // ── 4. Grants (OQ-5) ──────────────────────────────────────
            // agrisync_app keeps the same baseline grants Phase 03
            // BootstrapDbRoles minted for every ssf.* table (SELECT,
            // INSERT, UPDATE, DELETE). On cross_border_transfers we
            // narrow that to SELECT + INSERT only — the audit log is
            // append-only by privilege, not by policy. dpa_registry
            // keeps the default grants so the startup gap-warning's
            // read path resolves cleanly.
            //
            // The IF EXISTS guard on REVOKE keeps the migration safe to
            // re-run on environments where BootstrapDbRoles hasn't run
            // yet (test harnesses use EnsureCreatedAsync, which skips
            // the migrations history but still applies the table
            // shape — see Bootstrapper InitializeApplicationDataAsync).
            migrationBuilder.Sql(@"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        REVOKE UPDATE, DELETE ON ssf.cross_border_transfers FROM agrisync_app;
        GRANT SELECT, INSERT ON ssf.cross_border_transfers TO agrisync_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.dpa_registry TO agrisync_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "cross_border_transfers",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "dpa_registry",
                schema: "ssf");
        }
    }
}
