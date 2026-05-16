// spec: data-principle-spine-2026-05-05/04.4
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 04 sub-phase 04.4 — physically maps
    /// the four audit-provenance columns introduced in 04.1 (<c>app_version</c>,
    /// <c>device_id</c>, <c>ip_hash</c>, <c>source_ai_job_id</c>), revokes
    /// <c>UPDATE</c> and <c>DELETE</c> on the audit family
    /// (<c>audit_events</c>, <c>correction_events</c>, <c>ai_job_attempts</c>)
    /// from <c>agrisync_app</c>, and attaches the deferred-from-Phase-03 RLS
    /// policy on <c>ssf.audit_events</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Column adds (per plan §04.1.5).</b> All four columns ship in a
    /// three-step sequence so existing rows survive: (A) ADD nullable; (B)
    /// UPDATE historic rows with the sentinel triplet
    /// <c>('pre_spine','unknown','unknown')</c> matching the Phase 01 sentinel
    /// taxonomy (R3 OQ ruling 2026-05-16 — Phase 01's
    /// <c>20260514000000_AddProvenanceColumns</c> uses <c>'unknown'</c> for
    /// device/IP and <c>'pre_spine'</c> as the version sentinel; this
    /// migration preserves that vocabulary instead of stamping <c>'pre_spine'</c>
    /// across all three fields); (C) ALTER COLUMN to <c>NOT NULL</c>. The
    /// <c>source_ai_job_id</c> column stays nullable forever — it is only
    /// populated for audit rows whose entity originated from an AI pipeline.
    /// </para>
    /// <para>
    /// <b>REVOKE UPDATE, DELETE (per plan §04.4).</b> Audit-family lockdown
    /// covers three tables. Senior-architect R1 verdict (2026-05-17) verified
    /// that <c>REVOKE UPDATE ON ssf.ai_job_attempts</c> is safe:
    /// <c>AiJob.UpdateProvenance</c> mutates the PARENT (<c>ssf.ai_jobs</c>),
    /// not <c>ai_job_attempts</c>; the <c>_attempts.Add(attempt)</c> path
    /// only INSERTs new rows. The owner role (<c>agrisync_owner</c>) retains
    /// <c>UPDATE</c>/<c>DELETE</c> for the narrow DPDP §12 erasure case which
    /// Phase 08's <c>ErasureWorker</c> will exercise.
    /// </para>
    /// <para>
    /// <b>OQ-5 deferred-from-Phase-03 RLS.</b>
    /// <c>20260516130000_EnableRowLevelSecurity</c> §67-72 explicitly deferred
    /// <c>ssf.audit_events</c> RLS to this migration. <c>audit_events.farm_id</c>
    /// is NULLABLE (cross-farm audits exist for <c>IssueFarmInvite</c>,
    /// <c>ClaimJoin</c>, <c>ExitMembership</c>, admin elevations), so the policy
    /// admits NULL <c>farm_id</c> rows for any tenant (cross-tenant audit
    /// surface required by admin views) and tenant-scopes everything else on
    /// <c>current_setting('agrisync.farm_id', true)::uuid</c>.
    /// </para>
    /// <para>
    /// <b>Down() is reversible.</b> Reverses every step in inverse order: drop
    /// the RLS policy and DISABLE RLS, GRANT UPDATE/DELETE back to
    /// <c>agrisync_app</c>, drop the two new indexes, ALTER columns back to
    /// nullable, then DropColumn × 4. Idempotent SQL guards
    /// (<c>DROP POLICY IF EXISTS</c>) keep re-runs safe.
    /// </para>
    /// </remarks>
    public partial class HardenAuditIntegrity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── Step A: add the 4 columns as NULLABLE so the ALTER TABLE
            //   succeeds on tables that already contain rows.
            migrationBuilder.AddColumn<string>(
                name: "app_version",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "device_id",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ip_hash",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "source_ai_job_id",
                schema: "ssf",
                table: "audit_events",
                type: "uuid",
                nullable: true);

            // ── Step B: backfill historic rows with the R3 sentinel triplet.
            //   Aligns with Phase 01's 20260514000000_AddProvenanceColumns
            //   vocabulary: 'pre_spine' for the version, 'unknown' for the
            //   device/IP that no one ever captured.
            migrationBuilder.Sql(@"
UPDATE ssf.audit_events
SET app_version = 'pre_spine',
    device_id   = 'unknown',
    ip_hash     = 'unknown'
WHERE app_version IS NULL;
");

            // ── Step C: tighten to NOT NULL now that the backfill ensures
            //   every existing row has a value. New inserts must supply the
            //   forensic trio (AuditEventFactory guards this).
            migrationBuilder.AlterColumn<string>(
                name: "app_version",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "device_id",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "ip_hash",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80,
                oldNullable: true);

            // ── Step D: index app_version (forensic queries pivot on
            //   release cohorts) and source_ai_job_id (reconstruction joins
            //   from AiJob back to its emitted audit chain).
            migrationBuilder.CreateIndex(
                name: "ix_audit_events_app_version",
                schema: "ssf",
                table: "audit_events",
                column: "app_version");

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_source_ai_job_id",
                schema: "ssf",
                table: "audit_events",
                column: "source_ai_job_id");

            // ── Step E: REVOKE UPDATE/DELETE on the audit family. The app
            //   role keeps INSERT and SELECT; UPDATE and DELETE remain only
            //   on agrisync_owner (used by migrations and Phase 08 erasure).
            migrationBuilder.Sql(@"
-- Audit family becomes append-only at the role level for the app role.
REVOKE UPDATE, DELETE ON ssf.audit_events       FROM agrisync_app;
REVOKE UPDATE, DELETE ON ssf.correction_events  FROM agrisync_app;
REVOKE UPDATE, DELETE ON ssf.ai_job_attempts    FROM agrisync_app;
");

            // ── Step F: audit_events RLS policy (deferred from Phase 03 OQ-5).
            //   audit_events.farm_id is NULLABLE because cross-farm audits
            //   exist (IssueFarmInvite, ClaimJoin, ExitMembership, admin
            //   elevations). Policy: NULL farm_id rows are visible to any
            //   tenant (cross-tenant audit-trail surface required by admin
            //   views); rows with explicit farm_id are tenant-scoped on the
            //   same agrisync.farm_id GUC as every other RLS-enabled table.
            migrationBuilder.Sql(@"
ALTER TABLE ssf.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_audit_events ON ssf.audit_events;
CREATE POLICY p_tenant_audit_events ON ssf.audit_events
  USING      (farm_id IS NULL OR farm_id = current_setting('agrisync.farm_id', true)::uuid)
  WITH CHECK (farm_id IS NULL OR farm_id = current_setting('agrisync.farm_id', true)::uuid);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ── Reverse F: drop the RLS policy and DISABLE RLS on audit_events.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_audit_events ON ssf.audit_events;
ALTER TABLE ssf.audit_events DISABLE ROW LEVEL SECURITY;
");

            // ── Reverse E: GRANT UPDATE/DELETE back to agrisync_app on the
            //   three audit-family tables.
            migrationBuilder.Sql(@"
GRANT UPDATE, DELETE ON ssf.audit_events       TO agrisync_app;
GRANT UPDATE, DELETE ON ssf.correction_events  TO agrisync_app;
GRANT UPDATE, DELETE ON ssf.ai_job_attempts    TO agrisync_app;
");

            // ── Reverse D: drop the two new indexes.
            migrationBuilder.DropIndex(
                name: "ix_audit_events_app_version",
                schema: "ssf",
                table: "audit_events");

            migrationBuilder.DropIndex(
                name: "ix_audit_events_source_ai_job_id",
                schema: "ssf",
                table: "audit_events");

            // ── Reverse C: relax NOT NULL back to nullable so DropColumn
            //   semantics remain straightforward.
            migrationBuilder.AlterColumn<string>(
                name: "app_version",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);

            migrationBuilder.AlterColumn<string>(
                name: "device_id",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64);

            migrationBuilder.AlterColumn<string>(
                name: "ip_hash",
                schema: "ssf",
                table: "audit_events",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80);

            // ── Reverse A: drop all four columns.
            migrationBuilder.DropColumn(
                name: "app_version",
                schema: "ssf",
                table: "audit_events");

            migrationBuilder.DropColumn(
                name: "device_id",
                schema: "ssf",
                table: "audit_events");

            migrationBuilder.DropColumn(
                name: "ip_hash",
                schema: "ssf",
                table: "audit_events");

            migrationBuilder.DropColumn(
                name: "source_ai_job_id",
                schema: "ssf",
                table: "audit_events");
        }
    }
}
