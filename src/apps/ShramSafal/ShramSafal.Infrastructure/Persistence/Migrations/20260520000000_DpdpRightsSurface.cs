// spec: data-principle-spine-2026-05-05/08.1
// NOTE: Phase 10 implementor regenerated this stub after `dotnet ef
// migrations remove` (run during Phase 10 envelope work to clean up a
// temp scratch migration) inadvertently deleted the parallel Phase 08
// implementor's untracked migration file. The Phase 08 OWNER MUST
// audit + extend this file with their grant/RLS blocks BEFORE landing.
// The 4 tables below match the configurations Phase 08 already
// committed (BreachIncidentConfiguration, ErasureRequestConfiguration,
// ExportRequestConfiguration, RetentionSweepRunConfiguration). The
// envelope §10 hard rule "do not touch Phase 08 aggregates" was
// preserved — no Phase 08 .Domain / Application code is altered here.
//
// Once Phase 08 lands their final migration with the OQ-5 grant block
// + audit_read_telemetry + export_artifacts tables, this stub should
// be reconciled (Phase 08's body wins; this minimal scaffold ensures
// EF model snapshot consistency in the interim).
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DpdpRightsSurface : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "breach_incidents",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    detected_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    severity = table.Column<int>(type: "integer", nullable: false),
                    scope_description = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    affected_user_count = table.Column<int>(type: "integer", nullable: false),
                    board_notified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    principals_notified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    status = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_breach_incidents", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "erasure_requests",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    on_behalf_of_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<int>(type: "integer", nullable: false),
                    requested_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    completed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    rows_anonymized_count = table.Column<int>(type: "integer", nullable: true),
                    failure_reason = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_erasure_requests", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "export_requests",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    on_behalf_of_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<int>(type: "integer", nullable: false),
                    requested_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    completed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    presigned_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    expires_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    failure_reason = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_export_requests", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "retention_sweep_runs",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    tables_swept = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    rows_removed_count = table.Column<int>(type: "integer", nullable: false),
                    s3_objects_removed_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_retention_sweep_runs", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_breach_incidents_detected",
                schema: "ssf",
                table: "breach_incidents",
                column: "detected_at_utc");

            migrationBuilder.CreateIndex(
                name: "ix_breach_incidents_status",
                schema: "ssf",
                table: "breach_incidents",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_erasure_requests_requested_by",
                schema: "ssf",
                table: "erasure_requests",
                column: "requested_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_erasure_requests_status",
                schema: "ssf",
                table: "erasure_requests",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_export_requests_requested_by",
                schema: "ssf",
                table: "export_requests",
                column: "requested_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_export_requests_status",
                schema: "ssf",
                table: "export_requests",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_retention_sweep_runs_occurred",
                schema: "ssf",
                table: "retention_sweep_runs",
                column: "occurred_at_utc");

            // ── Coordinator reconciliation 2026-05-17 ─────────────────────
            // Phase 10 implementor's accidental `dotnet ef migrations remove`
            // stripped this migration to a 4-table stub. Phase 08 implementor
            // report (a6685a21b280439d0) named two additional worker-only
            // tables that the stub MUST add, otherwise RetentionSweepWorker
            // crashes at runtime (it uses raw SQL against both — see
            // src/AgriSync.Bootstrapper/Jobs/RetentionSweepWorker.cs).
            //
            // These are worker-only tables (no EF aggregate, no DbSet,
            // no model snapshot entry needed). Created via raw migrations.
            migrationBuilder.CreateTable(
                name: "export_artifacts",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    s3_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    presigned_url_expires_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_export_artifacts", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_export_artifacts_created",
                schema: "ssf",
                table: "export_artifacts",
                column: "created_at_utc");

            migrationBuilder.CreateIndex(
                name: "ix_export_artifacts_user",
                schema: "ssf",
                table: "export_artifacts",
                column: "user_id");

            migrationBuilder.CreateTable(
                name: "audit_read_telemetry",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_type = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    read_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_read_telemetry", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_audit_read_telemetry_read_at",
                schema: "ssf",
                table: "audit_read_telemetry",
                column: "read_at_utc");

            migrationBuilder.CreateIndex(
                name: "ix_audit_read_telemetry_actor",
                schema: "ssf",
                table: "audit_read_telemetry",
                column: "actor_user_id");

            // Standard grants for the 6 Phase 08 tables.
            // These are NOT audit-family (Phase 04 doctrine doesn't apply);
            // standard SELECT+INSERT+UPDATE+DELETE so RetentionSweepWorker +
            // ErasureWorker + ExportWorker can do their jobs through the
            // agrisync_app role (workers open admin contexts via
            // IAdminDbContextFactory which uses the migration role; this
            // grant covers the request-path reads/writes from non-elevated
            // contexts e.g. user POSTing /shramsafal/me/erasure/request).
            //
            // Guarded by IF EXISTS pg_roles agrisync_app for parity with
            // 20260518000000_PrivacyEdge.cs (the role only exists after
            // 20260515090000_BootstrapDbRoles runs; dev shells without it
            // skip silently).
            migrationBuilder.Sql(@"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.breach_incidents      TO agrisync_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.erasure_requests      TO agrisync_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.export_requests       TO agrisync_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.retention_sweep_runs  TO agrisync_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.export_artifacts      TO agrisync_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.audit_read_telemetry  TO agrisync_app;
    END IF;
END $$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "breach_incidents",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "erasure_requests",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "export_requests",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "retention_sweep_runs",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "export_artifacts",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "audit_read_telemetry",
                schema: "ssf");
        }
    }
}
