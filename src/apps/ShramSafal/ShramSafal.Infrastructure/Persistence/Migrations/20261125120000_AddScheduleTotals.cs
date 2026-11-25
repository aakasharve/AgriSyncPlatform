// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, "Library, profile and honest numbers"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Follow = taken into my schedule. Done, and heard, are separate counts. Creators see totals only, hidden for small groups. No number without evidence (P4)")
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 schedule slice 13 - "who follows which schedule". Adds ONE narrow cross-farm read and the list it needs:
    /// <list type="bullet">
    /// <item><c>ssf.schedule_chain_totals(p_chain_id uuid, p_task_keys text[])</c>: <c>SECURITY DEFINER</c>, <c>STABLE</c>, <c>SET search_path = pg_catalog, ssf</c>. It returns AGGREGATES ONLY:
    /// rows of (metric, task key, farmers, amount). It is the ONLY thing that reads across farms for the totals, and the five-farmer threshold, the test-farm list and the Public-schedule rule are applied INSIDE
    /// it, so a direct call can never return a number under five, count a listed farm or count a schedule that is not Public.</item>
    /// <item><c>ssf.schedule_totals_excluded_farms</c>: farm id, reason, who, when. FORCE ROW LEVEL SECURITY; NO policy the app role matches and NO grant for it: the application neither reads nor writes
    /// it, only the function (through its owner policy) reads it. Rows are added by a deploy SQL step (the founder's and test farms), not by this migration.</item>
    /// <item>One extra <c>FOR SELECT</c> policy <c>p_totals_owner_select</c> <c>TO</c> the function's OWNER role only, <c>USING (true)</c>, on each source table the function reads (own works, their
    /// origins, choices of a schedule, the heard rows, the owner messages, the jobs, the farms) and on the list. No other role, and never PUBLIC.</item>
    /// </list>
    ///
    /// <para><b>Why the app role can never match the new policy (the role model).</b> FORCE ROW LEVEL SECURITY applies to a table's owner, so the owner of a SECURITY DEFINER function is subject to the policies like
    /// anyone; the extra policy is the owner's ticket. Postgres applies a policy to the named role AND ITS MEMBERS, so the policy would also open every farm to <c>agrisync_app</c> if the app role were the owner
    /// or a member of it. The migration therefore REFUSES (<see cref="OwnerPoliciesSql"/>, before any policy is written) when the owner role is <c>agrisync_app</c> or <c>agrisync_readonly</c>, or one of them
    /// is a member of it (<c>pg_has_role(..., 'MEMBER')</c>). The owner is the role that RUNS this migration: the same role that created the tables (<c>BootstrapDbRoles</c> makes the schema's owner
    /// <c>agrisync_owner</c> and only grants the app role privileges and default privileges, never membership); in tests it is the superuser of the scratch database, in production the migration runner.
    /// A test runs the same refusal text against an owner that is, and one the app role is a member of.</para>
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. One new table, one new function, eight new policies and their grants. No existing table, column, policy, grant or row changes; the
    /// deployed binary never names any of them, so it runs unchanged against the migrated schema (P11). Nothing calls the function until the new route is served.</para>
    ///
    /// <para><b>Grants.</b> <c>REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ... TO agrisync_app</c> (inside the usual "agrisync_app exists" check), no other role. The list has NO grant for the
    /// app role or the read-only role (the default privileges that give the app role the other tables are revoked on it), and the migration REFUSES if the app role can still read it through any membership.</para>
    ///
    /// <para><b>Erasure and export.</b> KEEP for ShramSafal. The list holds farm ids chosen by ShramSafal staff and the words of why: no farmer's personal data (a farm id is an opaque id; the reason is staff words such
    /// as "test farm"). The function stores nothing. See <c>ErasureWorker.cs</c>.</para>
    ///
    /// <para><b>Down() REFUSES while the list has rows</b> (<see cref="DownRefusalSql"/>): rolling back would forget which test farms must never be counted. With none it drops the function, the extra policies and the
    /// list, and nothing else.</para>
    /// </summary>
    public partial class AddScheduleTotals : Migration
    {
        private const string Function = "ssf.schedule_chain_totals(uuid, text[])";

        /// <summary>The five-farmer threshold is inside the function text too (v_min); this constant is what tests and the application name it by.</summary>
        internal const int MinimumFarmers = 5;

        /// <summary>The seven tables the function reads across farms, and the list. Each gets the ONE owner policy.</summary>
        internal static readonly string[] OwnerPolicyTables =
        [
            "own_schedule_items", "own_schedule_item_origins", "schedule_subscriptions", "schedule_owner_message_states",
            "schedule_owner_messages", "planned_work", "farms", "schedule_totals_excluded_farms",
        ];

        /// <summary>Spelled out (not templated): the architecture tests read these exact statements to know the list is under row security.</summary>
        internal const string EnableRlsSql = @"
ALTER TABLE ssf.schedule_totals_excluded_farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_totals_excluded_farms FORCE ROW LEVEL SECURITY;
";

        /// <summary>
        /// The function. Aggregates only, one row per number; a number backed by fewer than <see cref="MinimumFarmers"/> distinct farmers is not a row at all. A farmer is a farm OWNER (distinct
        /// owner user id). Listed farms count nowhere. The chain must be Public in every version it has and must be a reference (a version with a task or a check), else nothing is returned.
        /// <c>following</c>: farmers with an ACTIVE own work whose CURRENT origin (latest sequence) is in the chain. <c>having</c>: farmers with an Active choice of any version of the chain.
        /// <c>work</c>: per task key, the farmers who hold it (limited to the keys asked for, when asked). <c>works_taken</c>: of the keys asked for, how many have an active taker (amount), backed by the farmers who took any.
        /// <c>done</c>: jobs closed Done that were made from an own work of the chain (amount = jobs). <c>heard</c>: farmers who heard a message of the chain.
        /// </summary>
        internal const string FunctionSql = @"
CREATE OR REPLACE FUNCTION ssf.schedule_chain_totals(p_chain_id uuid, p_task_keys text[] DEFAULT NULL)
RETURNS TABLE (metric text, task_key text, farmers integer, amount integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, ssf AS $fn$
#variable_conflict use_column
DECLARE
    v_min CONSTANT integer := 5;
BEGIN
    IF p_chain_id IS NULL THEN
        RETURN;
    END IF;

    -- A schedule that is not Public (own, team, licensed) and a sample (no task, no check: it stores no days) have no totals.
    IF NOT EXISTS (SELECT 1 FROM ssf.schedule_templates t WHERE COALESCE(t.chain_id, t.""Id"") = p_chain_id AND t.tenant_scope = 3)
       OR EXISTS (SELECT 1 FROM ssf.schedule_templates t WHERE COALESCE(t.chain_id, t.""Id"") = p_chain_id AND t.tenant_scope <> 3)
       OR NOT EXISTS (
            SELECT 1 FROM ssf.schedule_templates t
             WHERE COALESCE(t.chain_id, t.""Id"") = p_chain_id
               AND (EXISTS (SELECT 1 FROM ssf.schedule_tasks k WHERE k.schedule_template_id = t.""Id"")
                    OR EXISTS (SELECT 1 FROM ssf.schedule_checks c WHERE c.schedule_template_id = t.""Id""))) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH cur AS (
        -- every own work whose CURRENT origin is in this chain, its owner and its state; a listed farm is not here
        SELECT i.id AS item_id, i.owner_user_id AS owner_user_id, i.state AS state, o.source_task_key AS task_key
          FROM ssf.own_schedule_items i
          JOIN LATERAL (SELECT o2.source_chain_id, o2.source_task_key
                          FROM ssf.own_schedule_item_origins o2
                         WHERE o2.item_id = i.id
                         ORDER BY o2.sequence DESC
                         LIMIT 1) o ON TRUE
         WHERE o.source_chain_id = p_chain_id
           AND NOT EXISTS (SELECT 1 FROM ssf.schedule_totals_excluded_farms x WHERE x.farm_id = i.farm_id)
    ),
    active AS (SELECT c.item_id, c.owner_user_id, c.task_key FROM cur c WHERE c.state = 0),
    keyed AS (SELECT a.owner_user_id, a.task_key FROM active a WHERE p_task_keys IS NULL OR a.task_key = ANY (p_task_keys)),
    numbers AS (
        SELECT 'following'::text AS metric, NULL::text AS task_key,
               count(DISTINCT a.owner_user_id)::integer AS farmers, count(DISTINCT a.owner_user_id)::integer AS amount
          FROM active a
        UNION ALL
        SELECT 'having', NULL, count(DISTINCT f.owner_user_id)::integer, count(DISTINCT f.owner_user_id)::integer
          FROM ssf.schedule_subscriptions s
          JOIN ssf.farms f ON f.""Id"" = s.farm_id
         WHERE s.state = 0
           AND s.schedule_template_id IN (SELECT t.""Id"" FROM ssf.schedule_templates t WHERE COALESCE(t.chain_id, t.""Id"") = p_chain_id)
           AND NOT EXISTS (SELECT 1 FROM ssf.schedule_totals_excluded_farms x WHERE x.farm_id = s.farm_id)
        UNION ALL
        SELECT 'work', k.task_key, count(DISTINCT k.owner_user_id)::integer, count(DISTINCT k.owner_user_id)::integer
          FROM keyed k
         GROUP BY k.task_key
        UNION ALL
        SELECT 'works_taken', NULL, count(DISTINCT k.owner_user_id)::integer, count(DISTINCT k.task_key)::integer
          FROM keyed k
        UNION ALL
        SELECT 'done', NULL, count(DISTINCT c.owner_user_id)::integer, count(*)::integer
          FROM cur c
          JOIN ssf.planned_work w ON w.own_item_id = c.item_id
         WHERE w.status = 'Done'
        UNION ALL
        SELECT 'heard', NULL, count(DISTINCT st.owner_user_id)::integer, count(DISTINCT st.owner_user_id)::integer
          FROM ssf.schedule_owner_message_states st
          JOIN ssf.schedule_owner_messages m ON m.id = st.message_id
         WHERE st.kind = 0
           AND m.chain_id = p_chain_id
           AND NOT EXISTS (SELECT 1 FROM ssf.schedule_totals_excluded_farms x WHERE x.farm_id = st.farm_id)
    )
    SELECT n.metric, n.task_key, n.farmers, n.amount FROM numbers n WHERE n.farmers >= v_min;
END
$fn$;
";

        /// <summary>
        /// The refusal and the owner policies, in that order. Read from the function's REAL owner, so a test (or a later owner change) can run it again: it refuses, before any policy is touched, when the app role
        /// (or the read-only role) is, or is a member of, the owner; otherwise it (re)writes the ONE <c>p_totals_owner_select</c> policy of each table TO that owner only. Tests execute this same text.
        /// </summary>
        internal const string OwnerPoliciesSql = @"
DO $$
DECLARE
    v_owner name;
    v_role  name;
    v_table text;
BEGIN
    SELECT r.rolname INTO v_owner
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
     WHERE p.oid = to_regprocedure('ssf.schedule_chain_totals(uuid,text[])');
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Schedule totals refused: ssf.schedule_chain_totals does not exist, so there is no owner to write the read policies for. Nothing changed.';
    END IF;

    FOREACH v_role IN ARRAY ARRAY['agrisync_app', 'agrisync_readonly']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) AND pg_has_role(v_role, v_owner, 'MEMBER') THEN
            RAISE EXCEPTION 'Schedule totals refused: ssf.schedule_chain_totals is owned by role %, and the role % is, or is a member of, that role, so % would match the owner-only read policies that let the function read every farm. Run this migration as a role that % does not belong to. Nothing changed.',
                v_owner, v_role, v_role, v_role;
        END IF;
    END LOOP;

    FOREACH v_table IN ARRAY ARRAY['own_schedule_items', 'own_schedule_item_origins', 'schedule_subscriptions', 'schedule_owner_message_states',
                                   'schedule_owner_messages', 'planned_work', 'farms', 'schedule_totals_excluded_farms'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS p_totals_owner_select ON ssf.%I', v_table);
        EXECUTE format('CREATE POLICY p_totals_owner_select ON ssf.%I FOR SELECT TO %I USING (true)', v_table, v_owner);
    END LOOP;
END $$;
";

        /// <summary>The grants and the effective-privilege guard on the list. Tests execute this same text.</summary>
        internal const string GrantsSql = @"
REVOKE ALL ON FUNCTION ssf.schedule_chain_totals(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON TABLE ssf.schedule_totals_excluded_farms FROM PUBLIC;

DO $$
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; schedule totals grants not applicable here.';
        RETURN;
    END IF;

    GRANT EXECUTE ON FUNCTION ssf.schedule_chain_totals(uuid, text[]) TO agrisync_app;
    -- The default privileges of BootstrapDbRoles hand every new table to the app role: the list is the one table it must NOT have.
    REVOKE ALL ON TABLE ssf.schedule_totals_excluded_farms FROM agrisync_app;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
        REVOKE ALL ON TABLE ssf.schedule_totals_excluded_farms FROM agrisync_readonly;
    END IF;

    IF has_table_privilege('agrisync_app', 'ssf.schedule_totals_excluded_farms', 'SELECT')
       OR has_table_privilege('agrisync_app', 'ssf.schedule_totals_excluded_farms', 'INSERT')
       OR has_table_privilege('agrisync_app', 'ssf.schedule_totals_excluded_farms', 'UPDATE')
       OR has_table_privilege('agrisync_app', 'ssf.schedule_totals_excluded_farms', 'DELETE') THEN
        RAISE EXCEPTION 'Schedule totals refused: the application role can still read or write ssf.schedule_totals_excluded_farms (runner %), through a membership or a privilege a REVOKE on it cannot remove. Nothing changed.', current_user;
    END IF;
END $$;
";

        /// <summary>Down refusal (E8): rolling back would forget which test farms must never be counted. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_rows bigint;
BEGIN
    SELECT count(*) INTO v_rows FROM ssf.schedule_totals_excluded_farms;
    IF v_rows > 0 THEN
        RAISE EXCEPTION 'Down refused: % farm(s) are on the schedule totals exclusion list, and rolling back would forget which test farms must never be counted. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_rows;
    END IF;
END $$;
";

        /// <summary>Down drops the extra policies of the seven source tables (the list goes with its own table).</summary>
        internal const string DropPoliciesSql = @"
DROP POLICY IF EXISTS p_totals_owner_select ON ssf.own_schedule_items;
DROP POLICY IF EXISTS p_totals_owner_select ON ssf.own_schedule_item_origins;
DROP POLICY IF EXISTS p_totals_owner_select ON ssf.schedule_subscriptions;
DROP POLICY IF EXISTS p_totals_owner_select ON ssf.schedule_owner_message_states;
DROP POLICY IF EXISTS p_totals_owner_select ON ssf.schedule_owner_messages;
DROP POLICY IF EXISTS p_totals_owner_select ON ssf.planned_work;
DROP POLICY IF EXISTS p_totals_owner_select ON ssf.farms;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "schedule_totals_excluded_farms",
                schema: "ssf",
                columns: table => new
                {
                    farm_id = table.Column<System.Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    added_by = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    added_at_utc = table.Column<System.DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_totals_excluded_farms", x => x.farm_id);
                    table.CheckConstraint("ck_schedule_totals_excluded_farms_reason", "length(btrim(reason)) > 0 AND length(btrim(added_by)) > 0");
                });

            migrationBuilder.Sql(EnableRlsSql);
            migrationBuilder.Sql(FunctionSql);
            migrationBuilder.Sql(GrantsSql);
            migrationBuilder.Sql(OwnerPoliciesSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently forgets which farms are test farms. Raises (and so changes nothing) while any row exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS " + Function + ";");
            migrationBuilder.Sql(DropPoliciesSql);

            migrationBuilder.DropTable(
                name: "schedule_totals_excluded_farms",
                schema: "ssf");
        }
    }
}
