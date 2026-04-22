-- seed-platform-admins.sql
-- ------------------------------------------------------------------------
-- Seeds Platform+Owner memberships for every userId in a provided array.
-- Run ONCE per environment, post-migration. Idempotent.
--
-- Why this is not baked into a migration:
--   The Platform org itself IS seeded by a migration (fixed ID).
--   Admin user-ids come from appsettings.Admins[], which a migration
--   cannot read. This operational script bridges that gap until W0-B
--   pivots JwtTokenIssuer off the config array entirely.
--
-- Usage (dev):
--   psql -h localhost -p 5433 -U postgres -d agrisync_dev \
--     -v admin_user_ids="'{00000000-0000-0000-0000-000000000001}'" \
--     -f src/AgriSync.Bootstrapper/Scripts/seed-platform-admins.sql
--
-- The :admin_user_ids variable is a PostgreSQL array literal of UUIDs.
-- Wrap in single quotes so psql interpolates without shell expansion.
-- ------------------------------------------------------------------------

DO $$
DECLARE
    platform_org_id CONSTANT uuid := '00000000-0000-0000-0000-00000000a000';
    admin_id uuid;
BEGIN
    FOREACH admin_id IN ARRAY :admin_user_ids
    LOOP
        INSERT INTO ssf.organization_memberships
            (id, organization_id, user_id, role, added_by_user_id, joined_at_utc, is_active)
        SELECT gen_random_uuid(),
               platform_org_id,
               admin_id,
               0,           /* OrganizationRole.Owner */
               admin_id,    /* bootstrap: admin adds themselves */
               NOW(),
               true
        WHERE NOT EXISTS (
            SELECT 1 FROM ssf.organization_memberships
             WHERE organization_id = platform_org_id
               AND user_id = admin_id
               AND is_active = true
        );

        RAISE NOTICE 'Ensured Platform+Owner membership for user_id=%', admin_id;
    END LOOP;
END $$;
