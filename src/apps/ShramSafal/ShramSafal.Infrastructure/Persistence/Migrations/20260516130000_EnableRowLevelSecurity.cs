// spec: data-principle-spine-2026-05-05/03.3
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 03 sub-phase 03.3 — enable and
    /// <c>FORCE</c> Postgres Row-Level Security on every farm-scoped table in the
    /// <c>ssf</c> schema, keyed on
    /// <c>current_setting('agrisync.farm_id', true)::uuid</c>. Pairs with the
    /// 03.2 <c>TenantConnectionInterceptor</c> (commit <c>0024032</c>) which
    /// injects the tenant claim per transaction via <c>set_config(...,true)</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Policy shape.</b> Three flavours:
    /// <list type="bullet">
    /// <item><b>Direct.</b> Tables that carry <c>farm_id</c> get a single
    /// <c>p_tenant_{t}</c> policy comparing
    /// <c>farm_id = current_setting('agrisync.farm_id', true)::uuid</c>. The
    /// claim is cast once to <c>uuid</c> so the existing
    /// <c>ix_{t}_farm_id</c> b-tree indexes stay usable (a <c>::text</c>
    /// comparison would force a sequential scan on every query).</item>
    /// <item><b>EXISTS-join.</b> Tables that do not carry <c>farm_id</c> but
    /// have a deterministic FK chain to one that does
    /// (<c>verification_events</c>, <c>worker_assignments</c> via
    /// <c>daily_logs</c>; <c>ai_job_attempts</c>, <c>transcripts</c> via
    /// <c>ai_jobs</c>) get a policy that EXISTS-checks the parent row's
    /// <c>farm_id</c>. <c>WITH CHECK (true)</c> on these — the parent's
    /// policy is the gate on INSERT/UPDATE; we do not re-litigate FK validity
    /// here.</item>
    /// <item><b>Farms special.</b> <c>ssf.farms</c> keys on its own primary
    /// key. The column is the case-sensitive quoted <c>"Id"</c> (raw-SQL
    /// <c>CREATE TABLE</c> in <c>20260222080909_AddAuditEvents</c> declared
    /// it that way; EF's snake_case convention does not apply because the
    /// table was never created through <c>migrationBuilder.CreateTable</c>).
    /// An unquoted <c>id</c> here would fail with <c>column not found</c>.</item>
    /// </list>
    /// </para>
    /// <para>
    /// <b><c>cost_categories</c> is a global lookup.</b> RLS is enabled +
    /// <c>FORCE</c>d, then a <c>FOR SELECT USING (true)</c> policy permits
    /// reads from any tenant. A second <c>FOR ALL TO agrisync_app</c> policy
    /// with <c>USING (false) WITH CHECK (false)</c> explicitly denies the
    /// runtime app role from inserting/updating/deleting — the lookup is
    /// system-managed (migrations as <c>agrisync_owner</c>; FORCE'd RLS does
    /// not apply to the table owner outside its own policies, and the seed
    /// in <c>20260515130000_AddCostCategoriesLookup</c> runs as the
    /// migration runner). Defence in depth on top of the schema-level
    /// REVOKE the W1a bootstrap installed.
    /// </para>
    /// <para>
    /// <b><c>raw_blob_index</c> has no per-row tenant column</b> (it is
    /// content-addressed by <c>sha256</c>; the tenant linkage lives on the
    /// referencing <c>ai_jobs.raw_input_ref</c>). The policy EXISTS-joins on
    /// <c>ai_jobs.raw_input_ref LIKE '%' || raw_blob_index.sha256 || '%'</c>
    /// — the column is <c>raw_input_ref</c> (renamed from
    /// <c>input_storage_path</c> in
    /// <c>20260514000000_AddProvenanceColumns</c>), NOT
    /// <c>input_storage_path</c> as the plan body §03.3 L329 incorrectly
    /// stated. Plan superseded by the senior-architect Pre-Flight Brief on
    /// this point.
    /// </para>
    /// <para>
    /// <b>OQ-5 deferral — <c>ssf.audit_events</c>.</b> Per R1 verdict OQ-5
    /// (decisions-log 2026-05-16), <c>audit_events</c> RLS is colocated in
    /// Phase 04's audit-integrity migration alongside the
    /// <c>app_version</c>/<c>device_id</c>/<c>ip_hash</c> ALTER TABLE and
    /// <c>REVOKE UPDATE, DELETE FROM agrisync_app</c>. This migration
    /// intentionally does NOT touch <c>ssf.audit_events</c>.
    /// </para>
    /// <para>
    /// <b>OQ-9 deferral — <c>finance_corrections</c> and
    /// <c>correction_events</c>.</b> Neither table carries
    /// <c>farm_id</c> directly and neither has a settled FK chain to a
    /// farm-scoped parent at this point (<c>finance_corrections</c> links
    /// only to <c>cost_entry_id</c>; <c>correction_events</c> keys on
    /// <c>UserId</c> with no farm linkage). Logged as OQ-9 in the
    /// decisions-log on 2026-05-16; resolution is sub-phase 03.3b — either
    /// add a <c>farm_id</c> column with backfill or commit to an
    /// EXISTS-via-<c>cost_entries</c>/<c>farm_memberships</c> policy.
    /// </para>
    /// <para>
    /// <b>No <c>BYPASSRLS</c> on <c>agrisync_owner</c>.</b> Deferred to
    /// sub-phase 03.5 (admin cross-tenant escape hatch). Until then, the
    /// owner role retains its W1a-default privileges and is used solely by
    /// migrations.
    /// </para>
    /// <para>
    /// <b>Down() is reversible.</b> Drops every policy created in
    /// <see cref="Up"/> and <c>DISABLE</c>s RLS on every touched table.
    /// Idempotent (<c>DROP POLICY IF EXISTS</c>) so re-running is safe.
    /// Production rollback is snapshot-restore per the Phase 03 plan
    /// §Rollback section; this <c>Down()</c> exists for local-dev
    /// iteration parity with W1a / 02.x mini-spikes.
    /// </para>
    /// </remarks>
    public partial class EnableRowLevelSecurity : Migration
    {
        // ── Direct-keyed tables: carry farm_id natively ──────────────
        private static readonly string[] DirectFarmScopedTables =
        {
            "daily_logs",
            "cost_entries",
            "crop_cycles",
            "plots",
            "attachments",
            "compliance_signals",
            "job_cards",
            "workers",
            "test_instances",
            "ai_jobs",
            "farm_memberships",
        };

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. Direct farm_id-keyed tables (11 entries) ──────────
            foreach (var t in DirectFarmScopedTables)
            {
                migrationBuilder.Sql($@"
ALTER TABLE ssf.{t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.{t} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_{t} ON ssf.{t};
CREATE POLICY p_tenant_{t} ON ssf.{t}
  USING      (farm_id = current_setting('agrisync.farm_id', true)::uuid)
  WITH CHECK (farm_id = current_setting('agrisync.farm_id', true)::uuid);
");
            }

            // ── 2. ssf.farms — keys on its own quoted ""Id"" column ──
            //   Column is case-sensitive quoted "Id" because raw-SQL
            //   CREATE TABLE in 20260222080909_AddAuditEvents declared it
            //   that way; unquoted `id` would resolve to a non-existent
            //   column. Plan §03.3 L296 used unquoted `id::text`;
            //   superseded by the Pre-Flight Brief.
            migrationBuilder.Sql(@"
ALTER TABLE ssf.farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_farms ON ssf.farms;
CREATE POLICY p_tenant_farms ON ssf.farms
  USING      (""Id"" = current_setting('agrisync.farm_id', true)::uuid)
  WITH CHECK (""Id"" = current_setting('agrisync.farm_id', true)::uuid);
");

            // ── 3. EXISTS-join: verification_events → daily_logs ─────
            migrationBuilder.Sql(@"
ALTER TABLE ssf.verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.verification_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_verification_events ON ssf.verification_events;
CREATE POLICY p_tenant_verification_events ON ssf.verification_events
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = verification_events.daily_log_id
      AND d.farm_id = current_setting('agrisync.farm_id', true)::uuid
  ))
  WITH CHECK (true);
");

            // ── 4. EXISTS-join: worker_assignments → daily_logs ──────
            migrationBuilder.Sql(@"
ALTER TABLE ssf.worker_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.worker_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_worker_assignments ON ssf.worker_assignments;
CREATE POLICY p_tenant_worker_assignments ON ssf.worker_assignments
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = worker_assignments.daily_log_id
      AND d.farm_id = current_setting('agrisync.farm_id', true)::uuid
  ))
  WITH CHECK (true);
");

            // ── 5. EXISTS-join: ai_job_attempts → ai_jobs ────────────
            migrationBuilder.Sql(@"
ALTER TABLE ssf.ai_job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.ai_job_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_ai_job_attempts ON ssf.ai_job_attempts;
CREATE POLICY p_tenant_ai_job_attempts ON ssf.ai_job_attempts
  USING (EXISTS (
    SELECT 1 FROM ssf.ai_jobs j
    WHERE j.id = ai_job_attempts.ai_job_id
      AND j.farm_id = current_setting('agrisync.farm_id', true)::uuid
  ))
  WITH CHECK (true);
");

            // ── 6. EXISTS-join: transcripts → ai_jobs ────────────────
            migrationBuilder.Sql(@"
ALTER TABLE ssf.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.transcripts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_transcripts ON ssf.transcripts;
CREATE POLICY p_tenant_transcripts ON ssf.transcripts
  USING (EXISTS (
    SELECT 1 FROM ssf.ai_jobs j
    WHERE j.id = transcripts.ai_job_id
      AND j.farm_id = current_setting('agrisync.farm_id', true)::uuid
  ))
  WITH CHECK (true);
");

            // ── 7. EXISTS-join via LIKE: raw_blob_index → ai_jobs ────
            //   Tenant linkage is content-addressed: ai_jobs.raw_input_ref
            //   embeds the sha256 inside its storage path. Column is
            //   raw_input_ref (NOT input_storage_path — plan §03.3 L329
            //   was wrong; Pre-Flight Brief override).
            migrationBuilder.Sql(@"
ALTER TABLE ssf.raw_blob_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.raw_blob_index FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_raw_blob_index ON ssf.raw_blob_index;
CREATE POLICY p_tenant_raw_blob_index ON ssf.raw_blob_index
  USING (EXISTS (
    SELECT 1 FROM ssf.ai_jobs j
    WHERE j.raw_input_ref LIKE '%' || raw_blob_index.sha256 || '%'
      AND j.farm_id = current_setting('agrisync.farm_id', true)::uuid
  ))
  WITH CHECK (true);
");

            // ── 8. cost_categories — global read, deny app writes ────
            //   Two policies: SELECT-true for any caller; FOR ALL with
            //   USING(false)+WITH CHECK(false) targeted at agrisync_app
            //   denies that role's INSERT/UPDATE/DELETE explicitly. Seed
            //   data is written by migrations as the schema runner
            //   (current_user), which is NOT agrisync_app and is the
            //   table owner — the runner bypasses the deny policy.
            migrationBuilder.Sql(@"
ALTER TABLE ssf.cost_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.cost_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_global_cost_categories_read ON ssf.cost_categories;
CREATE POLICY p_global_cost_categories_read ON ssf.cost_categories
  FOR SELECT USING (true);
DROP POLICY IF EXISTS p_global_cost_categories_deny_write ON ssf.cost_categories;
CREATE POLICY p_global_cost_categories_deny_write ON ssf.cost_categories
  FOR ALL TO agrisync_app
  USING (false)
  WITH CHECK (false);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ── Reverse 1. Direct-keyed tables ───────────────────────
            foreach (var t in DirectFarmScopedTables)
            {
                migrationBuilder.Sql($@"
DROP POLICY IF EXISTS p_tenant_{t} ON ssf.{t};
ALTER TABLE ssf.{t} DISABLE ROW LEVEL SECURITY;
");
            }

            // ── Reverse 2. farms ─────────────────────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_farms ON ssf.farms;
ALTER TABLE ssf.farms DISABLE ROW LEVEL SECURITY;
");

            // ── Reverse 3. verification_events ───────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_verification_events ON ssf.verification_events;
ALTER TABLE ssf.verification_events DISABLE ROW LEVEL SECURITY;
");

            // ── Reverse 4. worker_assignments ────────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_worker_assignments ON ssf.worker_assignments;
ALTER TABLE ssf.worker_assignments DISABLE ROW LEVEL SECURITY;
");

            // ── Reverse 5. ai_job_attempts ───────────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_ai_job_attempts ON ssf.ai_job_attempts;
ALTER TABLE ssf.ai_job_attempts DISABLE ROW LEVEL SECURITY;
");

            // ── Reverse 6. transcripts ───────────────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_transcripts ON ssf.transcripts;
ALTER TABLE ssf.transcripts DISABLE ROW LEVEL SECURITY;
");

            // ── Reverse 7. raw_blob_index ────────────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_raw_blob_index ON ssf.raw_blob_index;
ALTER TABLE ssf.raw_blob_index DISABLE ROW LEVEL SECURITY;
");

            // ── Reverse 8. cost_categories ───────────────────────────
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_global_cost_categories_read ON ssf.cost_categories;
DROP POLICY IF EXISTS p_global_cost_categories_deny_write ON ssf.cost_categories;
ALTER TABLE ssf.cost_categories DISABLE ROW LEVEL SECURITY;
");
        }
    }
}
