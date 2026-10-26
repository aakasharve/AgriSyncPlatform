// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, BN-1)
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, BN-1) — the database half of "a join request
    /// is not access". Every user-scoped DATA read policy (<c>p_user_select_*</c> on plots, crop
    /// cycles, daily logs, cost entries, attachments, verification events, finance corrections,
    /// job cards, compliance signals, test instances, the labour / DFES / field-operator tables,
    /// attendance marks …) admitted a caller whose seat was merely "not ended"
    /// (<c>m.status NOT IN (5, 6)</c>): PendingOtpClaim, PendingApproval and Suspended read the
    /// farm's rows exactly like Active. Step 1 adds the first live path that stores a
    /// PendingApproval seat (typing the farm code), so this migration narrows every one of those
    /// predicates to <c>m.status = 3</c> (Active). The declared-owner arm
    /// (<c>f.owner_user_id = …</c>) is untouched.
    ///
    /// <para><b>Two policies deliberately keep "not ended".</b> <c>p_user_select_farms</c> and
    /// <c>p_user_select_memberships</c> are the RELATIONSHIP reads: <c>/shramsafal/farms/mine</c>
    /// and <c>/me/context</c> list a pending request (farm name + status, nothing else) so the
    /// person can see THAT it is pending, and the self-exit scope reads the seat so a request can
    /// always be withdrawn. Neither carries farm data, and every data policy re-checks the seat
    /// itself, so a visible farm row opens nothing.</para>
    ///
    /// <para><b>Introspection, not hand-transcription</b> — the
    /// <c>20260609144905_NullifHardenTenantGucRlsPolicies</c> technique. A DO-block reads each
    /// policy's current <c>USING</c> via <c>pg_get_expr</c>, replaces the exact DEPARSED token
    /// <c>(m.status &lt;&gt; ALL (ARRAY[5, 6]))</c> (how Postgres 16 prints
    /// <c>m.status NOT IN (5, 6)</c>; verified on a throwaway cluster) with
    /// <c>(m.status = 3)</c>, and re-applies it with <c>ALTER POLICY</c>. Every other byte of
    /// each expression is preserved. A second block RAISEs if any data policy still admits the
    /// old predicate, so a drifted token fails the migration loudly instead of no-op-ing.</para>
    ///
    /// <para><b>Behaviour classification (E8) — two claims; read both before any rollback.</b></para>
    /// <list type="number">
    /// <item><b>Deploy: narrowing, data-free.</b> No person who reads today loses a row — an
    /// ASSUMPTION about production, not a fact checked here: it holds only if production holds no
    /// seat with status 1, 2 or 4 (no live path before step 1 stores one: ClaimJoin goes straight
    /// to Active, no suspend use case exists). Verify before deploy with the read-only count
    /// <c>SELECT status, count(*) FROM ssf.farm_memberships WHERE status IN (1, 2, 4) GROUP BY 1</c>
    /// (expected: no rows). Any row it returns is a person whose next pull stops delivering that
    /// farm.</item>
    /// <item><b>Code rollback: NOT safe by itself.</b> This migration narrows only the
    /// <c>p_user_select_*</c> reads. It does not narrow the <c>p_tenant_*</c> policies, and it
    /// cannot change an older binary's own member checks: every release before this one
    /// (main <c>e48ff991</c> included) counts ANY seat that has not ended as a member —
    /// <c>GetFarmMembershipForTenantAsync</c>'s raw SQL is <c>status NOT IN (5, 6)</c>, and
    /// <c>GetUserRoleForFarmAsync</c> / <c>GetFarmIdsForUserAsync</c> /
    /// <c>IsUserMemberOfFarmAsync</c> agree. A typed-code request carries the farm's
    /// <c>owner_account_id</c>, so under an older binary its maker gets the REST farm scope
    /// (<c>agrisync.farm_id</c>), reads the farm through <c>p_tenant_*</c>, downloads it on
    /// <c>/sync/pull</c> (as a Worker) and writes to it on <c>/sync/push</c>, unapproved. E8:
    /// putting the old binary back leaves this schema in place, so a code rollback past this
    /// release REQUIRES the pre-rollback step
    /// <c>src/AgriSync.Bootstrapper/Scripts/end-typed-code-join-requests.sql</c> BEFORE the old
    /// binary starts. It ends every waiting typed-code request (Revoked + one audit row each);
    /// proven, as a non-superuser owner role under FORCE RLS, by
    /// <c>TypedCodeJoinRequestRollbackRealPostgresTests</c>.</item>
    /// </list>
    /// <para><c>Down()</c> runs the same step first, then restores the deparsed
    /// <c>NOT IN (5, 6)</c> on the same policy set: restoring "not ended" while typed-code requests
    /// still wait would re-open the farm's rows to them at the database too. (Local-dev parity;
    /// the production DB rollback floor is the pre-deploy snapshot.) No model change, so the
    /// snapshot is untouched.</para>
    /// </summary>
    public partial class RequireActiveMembershipForUserScopedDataReads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. Narrow every user-scoped DATA policy to Active seats ──────────
            migrationBuilder.Sql(@"
DO $$
DECLARE
    r      record;
    v_qual text;
BEGIN
    FOR r IN
        SELECT c.relname AS tbl,
               pol.polname AS pol,
               pg_get_expr(pol.polqual, pol.polrelid) AS qual
        FROM pg_policy pol
        JOIN pg_class c     ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ssf'
          AND pol.polname LIKE 'p\_user\_select\_%'
          AND pol.polname NOT IN ('p_user_select_farms', 'p_user_select_memberships')
          AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%(m.status <> ALL (ARRAY[5, 6]))%'
    LOOP
        v_qual := replace(r.qual, '(m.status <> ALL (ARRAY[5, 6]))', '(m.status = 3)');
        EXECUTE format('ALTER POLICY %I ON ssf.%I USING (%s)', r.pol, r.tbl, v_qual);
        RAISE NOTICE 'Active-only ssf policy % on %', r.pol, r.tbl;
    END LOOP;
END
$$;
");

            // ── 2. Fail loud: no data policy may still admit a non-Active seat ───
            migrationBuilder.Sql(@"
DO $$
DECLARE
    v_remaining int;
    v_active    int;
BEGIN
    SELECT count(*) INTO v_remaining
    FROM pg_policies
    WHERE schemaname = 'ssf'
      AND policyname LIKE 'p\_user\_select\_%'
      AND policyname NOT IN ('p_user_select_farms', 'p_user_select_memberships')
      AND coalesce(qual, '') LIKE '%<> ALL (ARRAY[5, 6])%';
    IF v_remaining > 0 THEN
        RAISE EXCEPTION 'Active-only narrowing incomplete: % ssf user-scoped data policies still admit status NOT IN (5, 6)', v_remaining;
    END IF;

    SELECT count(*) INTO v_active
    FROM pg_policies
    WHERE schemaname = 'ssf'
      AND policyname LIKE 'p\_user\_select\_%'
      AND coalesce(qual, '') LIKE '%(m.status = 3)%';
    IF v_active = 0 THEN
        RAISE EXCEPTION 'Active-only narrowing matched no ssf user-scoped data policy: the deparsed token drifted';
    END IF;
END
$$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ── 1. End every waiting typed-code request FIRST (see the E8 note) ──
            // The same block as Scripts/end-typed-code-join-requests.sql. FORCE RLS binds the
            // owner-role migration connection too (no tenant GUC → the UPDATE would match nothing,
            // the audit INSERT would be refused), so FORCE is lifted for these statements and put
            // back exactly as found — the 20260815080242_StripTranscriptFromCorrectionEvents
            // precedent. Counted before FORCE returns, and RAISEs rather than no-op.
            migrationBuilder.Sql(@"
DO $$
DECLARE
    v_memberships_forced boolean;
    v_audit_forced       boolean;
    v_left               bigint;
BEGIN
    SELECT relforcerowsecurity INTO v_memberships_forced
      FROM pg_class WHERE oid = 'ssf.farm_memberships'::regclass;
    SELECT relforcerowsecurity INTO v_audit_forced
      FROM pg_class WHERE oid = 'ssf.audit_events'::regclass;

    IF v_memberships_forced THEN
        ALTER TABLE ssf.farm_memberships NO FORCE ROW LEVEL SECURITY;
    END IF;
    IF v_audit_forced THEN
        ALTER TABLE ssf.audit_events NO FORCE ROW LEVEL SECURITY;
    END IF;

    INSERT INTO ssf.audit_events
        (""Id"", entity_type, entity_id, action, actor_user_id, actor_role, payload,
         occurred_at_utc, farm_id, client_command_id, app_version, device_id, ip_hash, source_ai_job_id)
    SELECT gen_random_uuid(),
           'FarmMembership',
           m.""Id"",
           'MemberJoinRequestEnded',
           'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
           'system',
           json_build_object(
               'farmId', m.farm_id,
               'userId', m.user_id,
               'previousStatus', 'PendingApproval',
               'reason', 'migration_down')::text,
           now(),
           m.farm_id,
           NULL,
           'migration-down',
           'migration',
           'sha256:migration',
           NULL
      FROM ssf.farm_memberships m
     WHERE m.status = 2 AND m.joined_via = 4;

    UPDATE ssf.farm_memberships
       SET status = 5,
           revoked_at_utc = now(),
           modified_at_utc = now()
     WHERE status = 2 AND joined_via = 4;

    SELECT count(*) INTO v_left
      FROM ssf.farm_memberships
     WHERE status = 2 AND joined_via = 4;

    IF v_audit_forced THEN
        ALTER TABLE ssf.audit_events FORCE ROW LEVEL SECURITY;
    END IF;
    IF v_memberships_forced THEN
        ALTER TABLE ssf.farm_memberships FORCE ROW LEVEL SECURITY;
    END IF;

    IF v_left > 0 THEN
        RAISE EXCEPTION 'Down(): % typed-code join request(s) still waiting; refusing to restore the not-ended predicate', v_left;
    END IF;
END
$$;
");

            // ── 2. Restore the "not ended" predicate on the same policy set ──────
            migrationBuilder.Sql(@"
DO $$
DECLARE
    r      record;
    v_qual text;
BEGIN
    FOR r IN
        SELECT c.relname AS tbl,
               pol.polname AS pol,
               pg_get_expr(pol.polqual, pol.polrelid) AS qual
        FROM pg_policy pol
        JOIN pg_class c     ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ssf'
          AND pol.polname LIKE 'p\_user\_select\_%'
          AND pol.polname NOT IN ('p_user_select_farms', 'p_user_select_memberships')
          AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%(m.status = 3)%'
    LOOP
        v_qual := replace(r.qual, '(m.status = 3)', '(m.status <> ALL (ARRAY[5, 6]))');
        EXECUTE format('ALTER POLICY %I ON ssf.%I USING (%s)', r.pol, r.tbl, v_qual);
    END LOOP;
END
$$;
");
        }
    }
}
