-- count-money-duplicate-keys.sql
-- ------------------------------------------------------------------------
-- spec: pre-launch-repair L2b (R-5; founder D-41 phase A "Identify affected historical records and provide a
-- reviewable, evidence-based cleanup plan. Preserve originals and leave uncertain facts unresolved.")
--
-- READ ONLY. Changes nothing: it runs inside a READ ONLY transaction and ends with ROLLBACK.
-- Plan and founder-approved next steps:
--   _COFOUNDER/Projects/AgriSync/Operations/PreLaunchRepair/plans/PLR-D41A-money-duplicate-cleanup-plan-2026-10-29.md
--
-- What it counts. Every bill line a phone sent carries the deterministic description "<billId>:<lineId>"
-- (or "<billId>:total"), and until L2b every send got a NEW random id. Builds that re-sent stored bills
-- (the old खरेदी page sent every stored bill line again on every visit) therefore left several rows with the
-- SAME description on the SAME farm. Those keys are exact — no guessing by amount or date. Words-only
-- descriptions (voice / typed money) are NOT counted: their copies cannot be told apart from two real
-- purchases, so they stay unresolved.
--
-- What each result means (first result: one row per farm that has any such key):
--   duplicated_keys          bill lines stored more than once on this farm
--   extra_rows               rows beyond the EARLIEST copy of each such key (the earliest is the original)
--   extra_amount             the money those extra rows add to the farm's totals today (stored amounts)
--   keys_whose_copies_differ keys whose copies disagree on amount, date, category, plot or person —
--                            UNCERTAIN: never voided automatically; shown to the owner
--   corrected_copies         copies that carry a correction — UNCERTAIN as well (the correction may have
--                            been the farmer's own fix of the duplicate)
-- Second result: every copy of every duplicated key, earliest first, with what the plan would propose
-- ("keep" for the earliest, "duplicate of <id>" for the rest) — a PROPOSAL for review, nothing more.
--
-- Role. ssf.cost_entries is FORCE ROW LEVEL SECURITY. Run it as a role that BYPASSES RLS, or it sees
-- nothing and would report "no duplicates" falsely — so the guard below refuses to report at all for a role
-- that cannot see every farm. Never lift FORCE RLS to run it: that is a schema change, not a read.
--
-- Proven by ShramSafal.Sync.IntegrationTests/Finance/AddCostEntryIdentityRealPostgresTests (seeded through
-- the real old-phone path on a throwaway cluster; the guard proven as the non-superuser app role).
-- ------------------------------------------------------------------------

BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION 'count-money-duplicate-keys: role % cannot read every farm''s ssf.cost_entries (FORCE ROW LEVEL SECURITY). Nothing was counted. Run it as a role that bypasses RLS.', current_user;
    END IF;
END $$;

-- 1. Per farm.
WITH keyed AS (
    SELECT ce."Id" AS id, ce.farm_id, ce.description, ce.amount, ce.entry_date, ce.category_id, ce.plot_id,
           ce.created_by_user_id, ce.created_at_utc, ce.is_corrected
    FROM ssf.cost_entries ce
    WHERE ce.description ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|total)$'
), ranked AS (
    SELECT k.*,
           row_number() OVER (PARTITION BY k.farm_id, k.description ORDER BY k.created_at_utc, k.id) AS copy_no,
           count(*) OVER (PARTITION BY k.farm_id, k.description) AS copies,
           count(*) OVER (PARTITION BY k.farm_id, k.description, k.amount, k.entry_date, k.category_id,
                                       k.plot_id, k.created_by_user_id) AS copies_like_this_one
    FROM keyed k
)
SELECT farm_id,
       count(DISTINCT description) FILTER (WHERE copies > 1)                                AS duplicated_keys,
       count(*) FILTER (WHERE copies > 1 AND copy_no > 1)                                  AS extra_rows,
       coalesce(sum(amount) FILTER (WHERE copies > 1 AND copy_no > 1), 0)                  AS extra_amount,
       count(DISTINCT description) FILTER (WHERE copies > 1 AND copies_like_this_one < copies) AS keys_whose_copies_differ,
       count(*) FILTER (WHERE copies > 1 AND is_corrected)                                 AS corrected_copies
FROM ranked
GROUP BY farm_id
HAVING count(*) FILTER (WHERE copies > 1) > 0
ORDER BY farm_id;

-- 2. Every copy, for review.
WITH keyed AS (
    SELECT ce."Id" AS id, ce.farm_id, ce.description, ce.amount, ce.entry_date, ce.category_id, ce.plot_id,
           ce.created_by_user_id, ce.created_at_utc, ce.is_corrected
    FROM ssf.cost_entries ce
    WHERE ce.description ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|total)$'
), ranked AS (
    SELECT k.*,
           row_number() OVER (PARTITION BY k.farm_id, k.description ORDER BY k.created_at_utc, k.id) AS copy_no,
           count(*) OVER (PARTITION BY k.farm_id, k.description) AS copies,
           first_value(k.id) OVER (PARTITION BY k.farm_id, k.description ORDER BY k.created_at_utc, k.id) AS original_id
    FROM keyed k
)
SELECT farm_id, description AS bill_line_key, copy_no, copies, id, amount, entry_date, category_id, plot_id,
       created_by_user_id, created_at_utc, is_corrected,
       CASE WHEN copy_no = 1 THEN 'keep (earliest)' ELSE 'duplicate of ' || original_id::text END AS proposal
FROM ranked
WHERE copies > 1
ORDER BY farm_id, description, copy_no;

ROLLBACK;
