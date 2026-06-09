// spec: nullif-harden-tenant-guc-rls-policies-2026-06-09
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// NULLIF-HARDEN_TENANT_GUC_RLS_2026-06-09 — defence-in-depth hardening of
    /// every <c>ssf</c> RLS policy that casts a tenant GUC straight to
    /// <c>uuid</c>. The legacy <c>p_tenant_*</c> policies (migration
    /// <c>20260516130000_EnableRowLevelSecurity</c> + the deferred
    /// <c>p_tenant_audit_events</c> / <c>p_tenant_finance_corrections</c> and the
    /// <c>p_user_correction_events</c> policy) render their tenant predicate as
    /// <c>(current_setting('agrisync.&lt;guc&gt;'::text, true))::uuid</c>.
    /// <c>current_setting(..., true)</c> returns NULL when the GUC is UNSET, but
    /// returns the empty string <c>''</c> when the interceptor has emitted
    /// <c>SET LOCAL agrisync.&lt;guc&gt; = ''</c> (it does so for any request that
    /// reaches a DbCommand with no value for that GUC — e.g. user-scoped reads
    /// that set only <c>agrisync.user_id</c>, leaving <c>agrisync.farm_id</c>
    /// empty). <c>''::uuid</c> throws Npgsql <c>22P02 invalid input syntax for
    /// type uuid: ""</c>, which surfaced as:
    /// <list type="bullet">
    /// <item><c>GET /shramsafal/farms/mine</c> — a CONSISTENT 500 (its repo
    /// self-scopes via <c>agrisync.user_id</c> only, so the legacy farm_id
    /// policy is always evaluated with an empty farm_id GUC).</item>
    /// <item><c>GET /sync/pull</c> — an INTERMITTENT 500 (the NULLIF-safe
    /// user-scoped policy usually matches first and short-circuits the
    /// permissive OR, but Postgres sometimes evaluates the bare-cast policy
    /// too).</item>
    /// </list>
    ///
    /// <para>
    /// <b>The fix.</b> Wrap every bare GUC cast in
    /// <c>NULLIF(current_setting('agrisync.&lt;guc&gt;'::text, true), ''::text)</c>
    /// so an empty-string GUC coerces to NULL (row not matched) instead of
    /// crashing. This is byte-identical behaviour for any real uuid value and
    /// NEVER loosens isolation (empty → matches nothing, same intent as the
    /// crash). It is the convention the newer <c>p_user_select_*</c> policies
    /// (migrations <c>20260606074635</c> / <c>20260607120000</c>) already use.
    /// </para>
    ///
    /// <para>
    /// <b>Scope: all three tenant GUCs</b> — <c>agrisync.farm_id</c>,
    /// <c>agrisync.user_id</c>, <c>agrisync.owner_account_id</c> — so the sibling
    /// <c>p_user_correction_events</c> (bare <c>user_id</c> cast) is hardened in
    /// the same pass rather than left as an identical landmine on another
    /// endpoint (senior-architect Pre-Flight Brief decision #1).
    /// </para>
    ///
    /// <para>
    /// <b>Introspection, not hand-transcription.</b> A PL/pgSQL DO-block reads
    /// each policy's current <c>USING</c> / <c>WITH CHECK</c> via
    /// <c>pg_get_expr</c>, performs a literal <c>replace()</c> of the exact
    /// normalized cast token, and re-applies it with <c>ALTER POLICY</c> —
    /// every other byte of each expression is preserved verbatim (no risk of a
    /// hand-typed predicate silently weakening isolation). A second DO-block
    /// ASSERTS that zero bare-cast tenant-GUC policies remain and
    /// <c>RAISE EXCEPTION</c>s otherwise, so the migration fails loudly on the
    /// clone dry-run if the token does not match (rather than silently no-op).
    /// </para>
    ///
    /// <para>
    /// This is a defence-in-depth SYMPTOM fix. The provenance of the empty-vs-
    /// NULL GUC (pooled-session residue vs an explicit empty SET LOCAL) is a
    /// separate follow-up; this migration guarantees no GUC cast can ever 500
    /// a read again. See ADR 0020.
    /// </para>
    ///
    /// <para>
    /// <b>Down()</b> reverses the wrap for local-dev parity (prod rollback is
    /// snapshot-restore). Idempotent: re-running Up is a no-op once hardened
    /// (the loop only matches still-bare policies).
    /// </para>
    /// </summary>
    public partial class NullifHardenTenantGucRlsPolicies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. Harden every bare tenant-GUC cast in ssf policies ──────────
            migrationBuilder.Sql(@"
DO $$
DECLARE
    r       record;
    v_qual  text;
    v_check text;
BEGIN
    FOR r IN
        SELECT c.relname AS tbl,
               pol.polname AS pol,
               pg_get_expr(pol.polqual, pol.polrelid)      AS qual,
               pg_get_expr(pol.polwithcheck, pol.polrelid)  AS wcheck
        FROM pg_policy pol
        JOIN pg_class c     ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ssf'
          AND (
                pg_get_expr(pol.polqual, pol.polrelid)      LIKE '%(current_setting(''agrisync.farm_id''::text, true))::uuid%'
             OR pg_get_expr(pol.polqual, pol.polrelid)      LIKE '%(current_setting(''agrisync.user_id''::text, true))::uuid%'
             OR pg_get_expr(pol.polqual, pol.polrelid)      LIKE '%(current_setting(''agrisync.owner_account_id''::text, true))::uuid%'
             OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%(current_setting(''agrisync.farm_id''::text, true))::uuid%'
             OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%(current_setting(''agrisync.user_id''::text, true))::uuid%'
             OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%(current_setting(''agrisync.owner_account_id''::text, true))::uuid%'
          )
    LOOP
        v_qual := r.qual;
        v_qual := replace(v_qual, '(current_setting(''agrisync.farm_id''::text, true))::uuid',          '(NULLIF(current_setting(''agrisync.farm_id''::text, true), ''''::text))::uuid');
        v_qual := replace(v_qual, '(current_setting(''agrisync.user_id''::text, true))::uuid',          '(NULLIF(current_setting(''agrisync.user_id''::text, true), ''''::text))::uuid');
        v_qual := replace(v_qual, '(current_setting(''agrisync.owner_account_id''::text, true))::uuid', '(NULLIF(current_setting(''agrisync.owner_account_id''::text, true), ''''::text))::uuid');

        IF r.wcheck IS NULL THEN
            EXECUTE format('ALTER POLICY %I ON ssf.%I USING (%s)', r.pol, r.tbl, v_qual);
        ELSE
            v_check := r.wcheck;
            v_check := replace(v_check, '(current_setting(''agrisync.farm_id''::text, true))::uuid',          '(NULLIF(current_setting(''agrisync.farm_id''::text, true), ''''::text))::uuid');
            v_check := replace(v_check, '(current_setting(''agrisync.user_id''::text, true))::uuid',          '(NULLIF(current_setting(''agrisync.user_id''::text, true), ''''::text))::uuid');
            v_check := replace(v_check, '(current_setting(''agrisync.owner_account_id''::text, true))::uuid', '(NULLIF(current_setting(''agrisync.owner_account_id''::text, true), ''''::text))::uuid');
            EXECUTE format('ALTER POLICY %I ON ssf.%I USING (%s) WITH CHECK (%s)', r.pol, r.tbl, v_qual, v_check);
        END IF;

        RAISE NOTICE 'NULLIF-hardened ssf policy % on %', r.pol, r.tbl;
    END LOOP;
END
$$;
");

            // ── 2. Fail-loud assertion: zero bare-cast tenant GUCs remain ─────
            migrationBuilder.Sql(@"
DO $$
DECLARE
    v_remaining int;
BEGIN
    SELECT count(*) INTO v_remaining
    FROM pg_policies
    WHERE schemaname = 'ssf'
      AND (
            coalesce(qual, '')       LIKE '%(current_setting(''agrisync.farm_id''::text, true))::uuid%'
         OR coalesce(qual, '')       LIKE '%(current_setting(''agrisync.user_id''::text, true))::uuid%'
         OR coalesce(qual, '')       LIKE '%(current_setting(''agrisync.owner_account_id''::text, true))::uuid%'
         OR coalesce(with_check, '') LIKE '%(current_setting(''agrisync.farm_id''::text, true))::uuid%'
         OR coalesce(with_check, '') LIKE '%(current_setting(''agrisync.user_id''::text, true))::uuid%'
         OR coalesce(with_check, '') LIKE '%(current_setting(''agrisync.owner_account_id''::text, true))::uuid%'
      );
    IF v_remaining > 0 THEN
        RAISE EXCEPTION 'NULLIF-hardening incomplete: % bare-cast tenant-GUC ssf policies remain', v_remaining;
    END IF;
END
$$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reverse the NULLIF wrap (local-dev parity; prod rollback = snapshot).
            migrationBuilder.Sql(@"
DO $$
DECLARE
    r       record;
    v_qual  text;
    v_check text;
BEGIN
    FOR r IN
        SELECT c.relname AS tbl,
               pol.polname AS pol,
               pg_get_expr(pol.polqual, pol.polrelid)      AS qual,
               pg_get_expr(pol.polwithcheck, pol.polrelid)  AS wcheck
        FROM pg_policy pol
        JOIN pg_class c     ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ssf'
          AND (
                pg_get_expr(pol.polqual, pol.polrelid)      LIKE '%NULLIF(current_setting(''agrisync.farm_id''::text, true), ''''::text)%'
             OR pg_get_expr(pol.polqual, pol.polrelid)      LIKE '%NULLIF(current_setting(''agrisync.user_id''::text, true), ''''::text)%'
             OR pg_get_expr(pol.polqual, pol.polrelid)      LIKE '%NULLIF(current_setting(''agrisync.owner_account_id''::text, true), ''''::text)%'
             OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%NULLIF(current_setting(''agrisync.farm_id''::text, true), ''''::text)%'
             OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%NULLIF(current_setting(''agrisync.user_id''::text, true), ''''::text)%'
             OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%NULLIF(current_setting(''agrisync.owner_account_id''::text, true), ''''::text)%'
          )
    LOOP
        v_qual := r.qual;
        v_qual := replace(v_qual, '(NULLIF(current_setting(''agrisync.farm_id''::text, true), ''''::text))::uuid',          '(current_setting(''agrisync.farm_id''::text, true))::uuid');
        v_qual := replace(v_qual, '(NULLIF(current_setting(''agrisync.user_id''::text, true), ''''::text))::uuid',          '(current_setting(''agrisync.user_id''::text, true))::uuid');
        v_qual := replace(v_qual, '(NULLIF(current_setting(''agrisync.owner_account_id''::text, true), ''''::text))::uuid', '(current_setting(''agrisync.owner_account_id''::text, true))::uuid');

        IF r.wcheck IS NULL THEN
            EXECUTE format('ALTER POLICY %I ON ssf.%I USING (%s)', r.pol, r.tbl, v_qual);
        ELSE
            v_check := r.wcheck;
            v_check := replace(v_check, '(NULLIF(current_setting(''agrisync.farm_id''::text, true), ''''::text))::uuid',          '(current_setting(''agrisync.farm_id''::text, true))::uuid');
            v_check := replace(v_check, '(NULLIF(current_setting(''agrisync.user_id''::text, true), ''''::text))::uuid',          '(current_setting(''agrisync.user_id''::text, true))::uuid');
            v_check := replace(v_check, '(NULLIF(current_setting(''agrisync.owner_account_id''::text, true), ''''::text))::uuid', '(current_setting(''agrisync.owner_account_id''::text, true))::uuid');
            EXECUTE format('ALTER POLICY %I ON ssf.%I USING (%s) WITH CHECK (%s)', r.pol, r.tbl, v_qual, v_check);
        END IF;
    END LOOP;
END
$$;
");
        }
    }
}
