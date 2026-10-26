-- end-typed-code-join-requests.sql
-- ------------------------------------------------------------------------
-- spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — MANDATORY PRE-ROLLBACK STEP.
--
-- Run this BEFORE an API binary older than the release that added
-- POST /shramsafal/join/by-code (typing a farm's code) is started against the
-- production database. Idempotent: a second run changes nothing.
--
-- Why it is needed (doctrine E8: a code rollback leaves the MIGRATED schema in
-- place). A typed code stores a join REQUEST: ssf.farm_memberships with
-- status = 2 (PendingApproval) and joined_via = 4 (SelfJoin), carrying the
-- farm's owner_account_id. The release that stores it refuses such a seat
-- everywhere (Active-only repository gates + the Active-only user-scoped read
-- policies). Every OLDER binary does not: its member checks count any seat that
-- has not ended (GetFarmMembershipForTenantAsync's raw SQL is
-- `status NOT IN (5, 6)`; GetUserRoleForFarmAsync, GetFarmIdsForUserAsync and
-- IsUserMemberOfFarmAsync likewise). Under an older binary a person who only
-- TYPED a code would get the farm's REST scope, read its rows through the
-- p_tenant_* policies, download it on /sync/pull and write to it on
-- /sync/push — without the owner ever approving.
--
-- What it does. Ends every waiting typed-code request: status 5 (Revoked),
-- revoked_at_utc set, and one audit row per request ('MemberJoinRequestEnded',
-- system actor) so history says why the request disappeared. Nothing else is
-- touched: Active, Suspended, Revoked and Exited seats, and PendingApproval
-- seats from any other path, keep every column. After the newer release is
-- back, the person simply types the code again.
--
-- Role. Run as the role that OWNS ssf.farm_memberships and ssf.audit_events
-- (the migration role). Both tables are FORCE ROW LEVEL SECURITY, which binds
-- the owner too: with no tenant GUC set the UPDATE would match nothing and the
-- INSERT would be refused. The block lifts FORCE for its own statements and
-- puts back exactly what it found (20260815080242_StripTranscriptFromCorrectionEvents
-- is the precedent). Run as any other non-superuser role it fails on the ALTER
-- and changes nothing (the transaction rolls back).
--
-- Proven by ShramSafal.Sync.IntegrationTests/Memberships/
-- TypedCodeJoinRequestRollbackRealPostgresTests (run as a non-superuser owner
-- role, under FORCE RLS).
--
-- Usage (example; host/user are the production migration connection):
--   psql "host=<db-host> dbname=agrisync user=<migration-role>" \
--     -v ON_ERROR_STOP=1 \
--     -f src/AgriSync.Bootstrapper/Scripts/end-typed-code-join-requests.sql
-- Expected output: NOTICE:  pre-rollback step: ended <N> typed-code join request(s); 0 remain
-- (Do not "check" afterwards with a plain SELECT as the same role: under FORCE RLS
-- with no tenant GUC it sees no row at all and would always say 0.)
-- ------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
    v_memberships_forced boolean;
    v_audit_forced       boolean;
    v_ended              bigint;
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
        ("Id", entity_type, entity_id, action, actor_user_id, actor_role, payload,
         occurred_at_utc, farm_id, client_command_id, app_version, device_id, ip_hash, source_ai_job_id)
    SELECT gen_random_uuid(),
           'FarmMembership',
           m."Id",
           'MemberJoinRequestEnded',
           'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
           'system',
           json_build_object(
               'farmId', m.farm_id,
               'userId', m.user_id,
               'previousStatus', 'PendingApproval',
               'reason', 'pre_rollback_step')::text,
           now(),
           m.farm_id,
           NULL,
           'pre-rollback-step',
           'operator',
           'sha256:operator',
           NULL
      FROM ssf.farm_memberships m
     WHERE m.status = 2 AND m.joined_via = 4;

    UPDATE ssf.farm_memberships
       SET status = 5,
           revoked_at_utc = now(),
           modified_at_utc = now()
     WHERE status = 2 AND joined_via = 4;
    GET DIAGNOSTICS v_ended = ROW_COUNT;

    -- Counted while FORCE is still lifted: once it is back, a count by this role would see
    -- no row at all (no tenant GUC) and report a reassuring, meaningless 0.
    SELECT count(*) INTO v_left
      FROM ssf.farm_memberships
     WHERE status = 2 AND joined_via = 4;

    IF v_audit_forced THEN
        ALTER TABLE ssf.audit_events FORCE ROW LEVEL SECURITY;
    END IF;
    IF v_memberships_forced THEN
        ALTER TABLE ssf.farm_memberships FORCE ROW LEVEL SECURITY;
    END IF;

    -- A step that silently matched nothing must not report success.
    IF v_left > 0 THEN
        RAISE EXCEPTION 'pre-rollback step did not take: % typed-code join request(s) still waiting', v_left;
    END IF;

    RAISE NOTICE 'pre-rollback step: ended % typed-code join request(s); 0 remain', v_ended;
END
$$;

COMMIT;
