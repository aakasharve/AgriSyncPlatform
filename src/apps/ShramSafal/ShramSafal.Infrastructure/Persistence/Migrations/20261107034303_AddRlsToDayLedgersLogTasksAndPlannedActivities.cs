// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RLS-2 (register F113): the database's second wall on the
// farm tables the February raw-SQL migrations created without row-level security.
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// lane RLS-2 — the day ledger (and its share lines), a log's task lines and a season's planned steps go behind the
    /// farm wall. The February migrations created them with raw SQL (<c>20260218073025_FinanceV2</c>,
    /// <c>20260222080909_AddAuditEvents</c>, <c>20260222095340_AddPhase7DayLedgerAndModifiedAt</c>), so the RLS
    /// allow-list scan never saw them until lane L8b-1 taught it to read raw SQL: every door checked the farm, but the
    /// database itself let any scope read and write every farm's rows.
    ///
    /// <para><b>Policy shapes (the house's own, nothing new).</b> Every table is ENABLEd and FORCEd: the app role owns its
    /// tables on every real cluster, and an owner bypasses ENABLE-only RLS.</para>
    /// <list type="bullet">
    /// <item><b>Direct <c>farm_id</c></b> — <c>ssf.day_ledgers</c> (and the February ledger kept as
    /// <c>day_ledgers_legacy_financev2</c>): the tenant policy of <c>20261106054532_AddScheduleSubscriptionDayZeroAndRls</c>,
    /// <c>farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid</c>, USING and WITH CHECK.</item>
    /// <item><b>No <c>farm_id</c></b> — an EXISTS through the parent, the <c>verification_events</c> shape of
    /// <c>20260516130000_EnableRowLevelSecurity</c>, but with a REAL <c>WITH CHECK</c> (the same EXISTS: the parent row
    /// must be in the current farm), never <c>WITH CHECK (true)</c>: <c>day_ledger_allocations</c> through
    /// <c>day_ledgers</c>, <c>log_tasks</c> through <c>daily_logs</c>, <c>planned_activities</c> through
    /// <c>crop_cycles</c>, the February share lines through the February ledger. No <c>farm_id</c> column is added (lane
    /// ruling): that would change the EF model, every write path and the sync.</item>
    /// <item><b>User-scoped reads</b> — <c>p_user_select_*</c> in the <c>20260607120000_AddUserScopedDataReadPolicies</c>
    /// shape (the farm's registrant, or an ACTIVE seat: <c>m.status = 3</c>, as
    /// <c>20261025204459_RequireActiveMembershipForUserScopedDataReads</c> left every data read), on the four tables a door
    /// reads with only <c>agrisync.user_id</c> set: the sync pull (day ledgers with their share lines, logs with their task
    /// lines, planned steps), the attention board and the money summary across a person's farms, and every "find the
    /// record's farm under his own scope first" lookup (a log is loaded WITH its task lines). Who of the farm may see which
    /// row stays the application's rule (E4). The February tables get no user read: no code reads them.</item>
    /// </list>
    ///
    /// <para><b>Why a real WITH CHECK holds here when F8 had to be reverted.</b> <c>20260703210908</c> reverted an
    /// EXISTS check because EF wrote a child BEFORE its same-batch parent: EF orders the commands of one SaveChanges by
    /// the relationships its MODEL knows, and those derivation tables had none to their parent. These children do:
    /// <c>day_ledger_allocations</c> is an owned collection of <c>DayLedger</c> and <c>log_tasks</c> is
    /// <c>DailyLog.Tasks</c> (a declared foreign key), so the parent is always written first. A planned step has no
    /// model relationship to its season, but every writer adds steps to a season that is already stored (plan
    /// generation, a local step) or, in the demo seeder's single SaveChanges, to seasons EF writes first (independent
    /// commands go in table order, and <c>crop_cycles</c> sorts before <c>planned_activities</c>). The same table order
    /// would DELETE a season before its steps, hiding each step from its own DELETE, so the one door that removes both
    /// (the demo reseed) flushes the steps first, as it already did for finance corrections before their cost entries.
    /// Lane RLS-2's real-Postgres suite drives each of those writes as <c>agrisync_app</c>.</para>
    ///
    /// <para><b>The February share-line table.</b> <c>FinanceV2</c> created <c>ssf.day_ledger_plot_allocations</c>, and
    /// <c>AddPhase7DayLedgerAndModifiedAt</c> renamed it (with its ledger) to <c>…_legacy_financev2</c> on every database
    /// this chain builds; nothing reads or writes either since. Both are protected under their live names, each only when
    /// it exists (a database that never ran FinanceV2 has neither). A table still named
    /// <c>day_ledger_plot_allocations</c> is not a state this chain produces, so the migration refuses it rather than
    /// leave it open.</para>
    ///
    /// <para><b>Behaviour (E8: classified by behaviour, not by operation).</b> FORCE RLS narrows: a read of these tables
    /// WITHOUT a farm or user scope now sees nothing, a write without the farm's scope is refused (42501), a delete without
    /// it deletes nothing. Every door of this binary that reads or writes them opens the scope first (lane RLS-2's door
    /// table). The deployed 1.0.17 phones are unaffected: the server's answers carry the same rows. No row is added,
    /// changed or removed; no column, index or grant changes.</para>
    ///
    /// <para><b>Down()</b> drops exactly the policies Up() creates and takes these tables back out of RLS (NO FORCE,
    /// DISABLE), as they were before. <b>It RE-OPENS THE FARM WALL on all of them</b>: any scope then reads and writes
    /// every farm's ledgers, task lines and planned steps. Roll back only together with the code, and re-apply Up() as
    /// soon as the code returns.</para>
    /// </summary>
    public partial class AddRlsToDayLedgersLogTasksAndPlannedActivities : Migration
    {
        internal const string SecuritySql = @"
-- ssf.day_ledgers: direct farm_id.
ALTER TABLE ssf.day_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.day_ledgers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_day_ledgers ON ssf.day_ledgers;
CREATE POLICY p_tenant_day_ledgers ON ssf.day_ledgers
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_select_day_ledgers ON ssf.day_ledgers;
CREATE POLICY p_user_select_day_ledgers ON ssf.day_ledgers
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = day_ledgers.farm_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

-- ssf.day_ledger_allocations: a ledger's share lines, through day_ledgers.
ALTER TABLE ssf.day_ledger_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.day_ledger_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_day_ledger_allocations ON ssf.day_ledger_allocations;
CREATE POLICY p_tenant_day_ledger_allocations ON ssf.day_ledger_allocations
  USING (EXISTS (
    SELECT 1 FROM ssf.day_ledgers l
    WHERE l.""Id"" = day_ledger_allocations.day_ledger_id
      AND l.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.day_ledgers l
    WHERE l.""Id"" = day_ledger_allocations.day_ledger_id
      AND l.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
DROP POLICY IF EXISTS p_user_select_day_ledger_allocations ON ssf.day_ledger_allocations;
CREATE POLICY p_user_select_day_ledger_allocations ON ssf.day_ledger_allocations
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.day_ledgers l
    JOIN ssf.farms f ON f.""Id"" = l.farm_id
    WHERE l.""Id"" = day_ledger_allocations.day_ledger_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

-- ssf.log_tasks: a log's task lines, through daily_logs.
ALTER TABLE ssf.log_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.log_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_log_tasks ON ssf.log_tasks;
CREATE POLICY p_tenant_log_tasks ON ssf.log_tasks
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = log_tasks.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    WHERE d.""Id"" = log_tasks.daily_log_id
      AND d.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
DROP POLICY IF EXISTS p_user_select_log_tasks ON ssf.log_tasks;
CREATE POLICY p_user_select_log_tasks ON ssf.log_tasks
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.daily_logs d
    JOIN ssf.farms f ON f.""Id"" = d.farm_id
    WHERE d.""Id"" = log_tasks.daily_log_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

-- ssf.planned_activities: a season's planned steps, through crop_cycles.
ALTER TABLE ssf.planned_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.planned_activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_planned_activities ON ssf.planned_activities;
CREATE POLICY p_tenant_planned_activities ON ssf.planned_activities
  USING (EXISTS (
    SELECT 1 FROM ssf.crop_cycles c
    WHERE c.""Id"" = planned_activities.crop_cycle_id
      AND c.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ssf.crop_cycles c
    WHERE c.""Id"" = planned_activities.crop_cycle_id
      AND c.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
  ));
DROP POLICY IF EXISTS p_user_select_planned_activities ON ssf.planned_activities;
CREATE POLICY p_user_select_planned_activities ON ssf.planned_activities
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.crop_cycles c
    JOIN ssf.farms f ON f.""Id"" = c.farm_id
    WHERE c.""Id"" = planned_activities.crop_cycle_id
      AND (
        f.owner_user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid
            AND m.status = 3
        )
      )
  ));

-- The February ledger and its share lines (FinanceV2, renamed by Phase 7), when present.
DO $$
BEGIN
    IF to_regclass('ssf.day_ledger_plot_allocations') IS NOT NULL THEN
        RAISE EXCEPTION 'ssf.day_ledger_plot_allocations exists under its February name: this database did not come from the migration chain (Phase 7 renames it to day_ledger_plot_allocations_legacy_financev2). Look before migrating; nothing was changed.';
    END IF;

    IF to_regclass('ssf.day_ledgers_legacy_financev2') IS NOT NULL THEN
        ALTER TABLE ssf.day_ledgers_legacy_financev2 ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ssf.day_ledgers_legacy_financev2 FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_tenant_day_ledgers_legacy_financev2 ON ssf.day_ledgers_legacy_financev2;
        CREATE POLICY p_tenant_day_ledgers_legacy_financev2 ON ssf.day_ledgers_legacy_financev2
          USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
          WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
    END IF;

    IF to_regclass('ssf.day_ledger_plot_allocations_legacy_financev2') IS NOT NULL THEN
        ALTER TABLE ssf.day_ledger_plot_allocations_legacy_financev2 ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ssf.day_ledger_plot_allocations_legacy_financev2 FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_tenant_day_ledger_plot_allocations_legacy_financev2 ON ssf.day_ledger_plot_allocations_legacy_financev2;
        CREATE POLICY p_tenant_day_ledger_plot_allocations_legacy_financev2 ON ssf.day_ledger_plot_allocations_legacy_financev2
          USING (EXISTS (
            SELECT 1 FROM ssf.day_ledgers_legacy_financev2 l
            WHERE l.id = day_ledger_plot_allocations_legacy_financev2.day_ledger_id
              AND l.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
          ))
          WITH CHECK (EXISTS (
            SELECT 1 FROM ssf.day_ledgers_legacy_financev2 l
            WHERE l.id = day_ledger_plot_allocations_legacy_financev2.day_ledger_id
              AND l.farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid
          ));
    END IF;
END $$;
";

        /// <summary>
        /// Fails the migration loudly (clone dry-run, test boot) unless every table is ENABLEd AND FORCEd, its tenant
        /// policy is keyed on farm_id in BOTH halves (a <c>WITH CHECK (true)</c> would let any farm's scope write any farm's
        /// child row), and the four live tables carry their user-scoped read limited to the registrant or an ACTIVE seat.
        /// A table that is enabled but not forced reports success while leaving the app role, which owns it, unconstrained.
        /// </summary>
        internal const string VerifySql = @"
DO $$
DECLARE
    t         text;
    v_live    boolean;
    v_enabled boolean;
    v_forced  boolean;
    v_qual    text;
    v_check   text;
    v_user    text;
BEGIN
    FOREACH t IN ARRAY ARRAY['day_ledgers', 'day_ledger_allocations', 'log_tasks', 'planned_activities',
                             'day_ledgers_legacy_financev2', 'day_ledger_plot_allocations_legacy_financev2'] LOOP
        v_live := t IN ('day_ledgers', 'day_ledger_allocations', 'log_tasks', 'planned_activities');

        IF to_regclass('ssf.' || t) IS NULL THEN
            IF v_live THEN
                RAISE EXCEPTION 'ssf.% does not exist', t;
            END IF;
            CONTINUE;  -- a February table this database never had
        END IF;

        SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_enabled, v_forced
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ssf' AND c.relname = t;

        IF NOT v_enabled THEN
            RAISE EXCEPTION 'ssf.% did not ENABLE ROW LEVEL SECURITY', t;
        END IF;

        IF NOT v_forced THEN
            RAISE EXCEPTION 'ssf.% did not FORCE ROW LEVEL SECURITY: the table owner (agrisync_app) would bypass the policy', t;
        END IF;

        SELECT pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid) INTO v_qual, v_check
          FROM pg_policy pol
          JOIN pg_class c     ON c.oid = pol.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ssf' AND c.relname = t AND pol.polname = 'p_tenant_' || t;

        IF v_qual IS NULL OR v_qual NOT LIKE '%farm_id%' THEN
            RAISE EXCEPTION 'p_tenant_% is missing on ssf.% or its USING is not keyed on farm_id (is: %)', t, t, v_qual;
        END IF;

        IF v_check IS NULL OR v_check NOT LIKE '%farm_id%' THEN
            RAISE EXCEPTION 'p_tenant_% on ssf.% has no farm-keyed WITH CHECK (is: %)', t, t, v_check;
        END IF;

        IF v_live THEN
            SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_user
              FROM pg_policy pol
              JOIN pg_class c     ON c.oid = pol.polrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'ssf' AND c.relname = t AND pol.polname = 'p_user_select_' || t
               AND pol.polcmd = 'r';

            IF v_user IS NULL OR v_user NOT LIKE '%agrisync.user_id%' OR v_user NOT LIKE '%(m.status = 3)%' THEN
                RAISE EXCEPTION 'p_user_select_% is missing on ssf.%, is not a SELECT policy, or admits a seat that is not ACTIVE (is: %)', t, t, v_user;
            END IF;
        END IF;
    END LOOP;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(SecuritySql);
            migrationBuilder.Sql(VerifySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DO $$
BEGIN
    IF to_regclass('ssf.day_ledger_plot_allocations_legacy_financev2') IS NOT NULL THEN
        DROP POLICY IF EXISTS p_tenant_day_ledger_plot_allocations_legacy_financev2 ON ssf.day_ledger_plot_allocations_legacy_financev2;
        ALTER TABLE ssf.day_ledger_plot_allocations_legacy_financev2 NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ssf.day_ledger_plot_allocations_legacy_financev2 DISABLE ROW LEVEL SECURITY;
    END IF;

    IF to_regclass('ssf.day_ledgers_legacy_financev2') IS NOT NULL THEN
        DROP POLICY IF EXISTS p_tenant_day_ledgers_legacy_financev2 ON ssf.day_ledgers_legacy_financev2;
        ALTER TABLE ssf.day_ledgers_legacy_financev2 NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ssf.day_ledgers_legacy_financev2 DISABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DROP POLICY IF EXISTS p_user_select_planned_activities ON ssf.planned_activities;
DROP POLICY IF EXISTS p_tenant_planned_activities ON ssf.planned_activities;
ALTER TABLE ssf.planned_activities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.planned_activities DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_user_select_log_tasks ON ssf.log_tasks;
DROP POLICY IF EXISTS p_tenant_log_tasks ON ssf.log_tasks;
ALTER TABLE ssf.log_tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.log_tasks DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_user_select_day_ledger_allocations ON ssf.day_ledger_allocations;
DROP POLICY IF EXISTS p_tenant_day_ledger_allocations ON ssf.day_ledger_allocations;
ALTER TABLE ssf.day_ledger_allocations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.day_ledger_allocations DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_user_select_day_ledgers ON ssf.day_ledgers;
DROP POLICY IF EXISTS p_tenant_day_ledgers ON ssf.day_ledgers;
ALTER TABLE ssf.day_ledgers NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.day_ledgers DISABLE ROW LEVEL SECURITY;
");
        }
    }
}
