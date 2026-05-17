// spec: data-principle-spine-2026-05-05/10.2
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.2 — third-party PII
    /// review queue + labour-heavy farm corpus gate. Ships
    /// <c>ssf.pii_review_queue</c> (admin-only, append-only ledger of
    /// every detection event) AND adds
    /// <c>ssf.farms.labour_heavy_corpus_enabled</c> (boolean column,
    /// default false; ops engineer flips manually per the runbook in
    /// <c>_COFOUNDER/Projects/AgriSync/Operations/Runbooks/LABOUR_HEAVY_CORPUS_ENABLEMENT.md</c>
    /// after counsel sign-off + first-100-clips review).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Timestamp 20260521000000.</b> Phase 08
    /// (<c>20260520000000_DpdpRightsSurface</c>) shipped at
    /// 2026-05-20T00:00:00Z; this migration lands one day later. Each
    /// EF migration history row is keyed on the file-name timestamp;
    /// strictly-monotonic ordering keeps the migration history
    /// replayable from a fresh database.
    /// </para>
    ///
    /// <para>
    /// <b>RLS exemption (OQ-6 — admin-only surface).</b>
    /// <c>ssf.pii_review_queue</c> ships WITHOUT a Row-Level Security
    /// policy. Reviewers span all farms (the
    /// <c>PiiReviewerAuthorizationHandler</c> grants access by
    /// allow-list claim, not by farm membership) — an RLS policy keyed
    /// on <c>agrisync.farm_id</c> would always evaluate to NULL for the
    /// admin endpoint (no farm claim in the JWT) and filter every row
    /// out. The grant boundary is the line of defence: <c>SELECT,
    /// INSERT, UPDATE</c> on the table for <c>agrisync_app</c>; DELETE
    /// is revoked so the queue is append-only by privilege (mirrors
    /// the Phase 04 audit-events doctrine). The table is added to
    /// <c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c> in this
    /// envelope with the justification "admin-only surface; no farm RLS
    /// (reviewers span all farms)".
    /// </para>
    ///
    /// <para>
    /// <b>Labour-heavy corpus gate (OQ-8).</b> The new
    /// <c>labour_heavy_corpus_enabled</c> column on <c>ssf.farms</c>
    /// defaults to <c>false</c>. The Phase 09 corpus reader query
    /// uses <c>WHERE labour_heavy_corpus_enabled = true OR
    /// job_card_count &lt;= 5</c>. No endpoint exposes the flip — ops
    /// engineers run a direct SQL UPDATE per the runbook (manual-only
    /// flip rationale: DPDP §8(4) accountability requires human eyes
    /// on each enablement).
    /// </para>
    ///
    /// <para>
    /// <b>jsonb detection payload.</b> <c>detection_json</c> stores the
    /// serialized <c>PiiDetection</c> outcome at scan time so the
    /// admin UI can render score / marker count / name count without
    /// re-parsing in C# (mirrors the Phase 06 <c>consent_audit</c>
    /// jsonb pattern).
    /// </para>
    /// </remarks>
    public partial class ThirdPartyPiiControls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. pii_review_queue ───────────────────────────────────
            // Admin-only surface; no RLS (allowlisted). Append-only by
            // privilege: the grant block below revokes DELETE.
            migrationBuilder.CreateTable(
                name: "pii_review_queue",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    transcript_id = table.Column<Guid>(type: "uuid", nullable: false),
                    original_text = table.Column<string>(type: "text", nullable: false),
                    redacted_text = table.Column<string>(type: "text", nullable: false),
                    detection_json = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    reviewed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    review_note = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    reviewed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pii_review_queue", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_pii_review_queue_status",
                schema: "ssf",
                table: "pii_review_queue",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_pii_review_queue_transcript_id",
                schema: "ssf",
                table: "pii_review_queue",
                column: "transcript_id");

            // ── 2. farms.labour_heavy_corpus_enabled ──────────────────
            // Default false. The runbook
            // LABOUR_HEAVY_CORPUS_ENABLEMENT.md documents the manual
            // flip + counsel sign-off ritual.
            migrationBuilder.AddColumn<bool>(
                name: "labour_heavy_corpus_enabled",
                schema: "ssf",
                table: "farms",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // ── 3. Grants ─────────────────────────────────────────────
            // pii_review_queue keeps SELECT/INSERT/UPDATE (reviewers
            // mutate status + note + reviewer_id) but DELETE is
            // revoked. The IF EXISTS guard matches the Phase 05/06
            // pattern (safe to re-run under EnsureCreatedAsync in
            // test harnesses).
            migrationBuilder.Sql(@"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, UPDATE ON ssf.pii_review_queue TO agrisync_app;
        REVOKE DELETE ON ssf.pii_review_queue FROM agrisync_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "labour_heavy_corpus_enabled",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropTable(
                name: "pii_review_queue",
                schema: "ssf");
        }
    }
}
