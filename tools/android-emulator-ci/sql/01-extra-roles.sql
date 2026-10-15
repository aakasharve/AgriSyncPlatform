-- CI-ONLY throwaway database. Adds the people the demo fixture does not have, so every role in the
-- verification journeys exists: co-owner (SecondaryOwner), a second Mukadam with no grant, and a
-- second farm with its own owner (for A -> B -> A separation). The demo fixture itself already
-- provides: owner (8888888888), Mukadam Shankar (9800000002), Workers Raju (9800000003) and
-- Santosh (9800000004). Mirrors the SQL used by the earlier local harnesses.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE k AS
SELECT u."Id" AS owner_id, f."Id" AS farm_a, f.owner_account_id AS acct
FROM public.users u JOIN ssf.farms f ON f.owner_user_id = u."Id"
WHERE u.phone = '8888888888' ORDER BY f.created_at_utc LIMIT 1;

DO $$ BEGIN
  IF (SELECT count(*) FROM k) <> 1 THEN RAISE EXCEPTION 'demo owner farm not found - did the purvesh-demo seed run?'; END IF;
END $$;

-- one shared demo password for every journey user (the demo fixture's own, public in the repo)
UPDATE public.users u SET password_hash = o.password_hash, auth_mode = o.auth_mode
FROM public.users o
WHERE o.phone = '8888888888' AND u.phone IN ('9800000002', '9800000003', '9800000004');

INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
SELECT x.id, x.phone, x.dn, p.password_hash, now(), now(), true, p.auth_mode, 'mr'
FROM (VALUES
  (md5('u:secondary')::uuid, '9800000010', 'Sunita Dusri Malkin'),
  (md5('u:mukadam2')::uuid,  '9800000011', 'Dattu Mukadam'),
  (md5('u:ownerB')::uuid,    '9800000030', 'Dusra Malak')) AS x(id, phone, dn),
  public.users p
WHERE p.phone = '8888888888';

-- farm B (isolation target)
INSERT INTO ssf.farms ("Id", name, owner_user_id, created_at_utc, modified_at_utc, farm_code, owner_account_id, geo_validation_status, weather_radius_km, labour_heavy_corpus_enabled)
VALUES (md5('farmB')::uuid, 'Dusri Sheti (Farm B)', md5('u:ownerB')::uuid, now(), now(), 'FARMB1',
        '00000000-0000-0000-0000-0000000000c3', 'Unchecked', 3.0, false);

-- memberships: farm A co-owner + ungranted Mukadam, farm B owner
INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, status, joined_via, owner_account_id, can_manage_labour_records)
SELECT md5('m:' || r.lbl)::uuid, k.farm_a, r.uid, r.role, now() - interval '30 days', now(), 3, 2, k.acct, false
FROM k, LATERAL (VALUES
  ('secondary', md5('u:secondary')::uuid, 'SecondaryOwner'),
  ('mukadam2',  md5('u:mukadam2')::uuid,  'Mukadam')) AS r(lbl, uid, role);

INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, status, joined_via, owner_account_id, can_manage_labour_records)
VALUES (md5('m:ownerB')::uuid, md5('farmB')::uuid, md5('u:ownerB')::uuid, 'PrimaryOwner', now(), now(), 3, 1,
        '00000000-0000-0000-0000-0000000000c3', false);

UPDATE public.users SET preferred_language = 'mr';

-- the demo fixture leaves farm_code empty; the invite link needs one (earlier harnesses set FRM001 too)
UPDATE ssf.farms SET farm_code = 'FRM001' WHERE "Id" = (SELECT farm_a FROM k) AND (farm_code IS NULL OR farm_code = '');

COMMIT;
