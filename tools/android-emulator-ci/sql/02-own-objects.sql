-- CI-ONLY. The schema is created by the build's own migrations run as the superuser, so every object
-- is superuser-owned. Re-own them to the NON-superuser application role so the API runs as that role
-- (FORCE ROW LEVEL SECURITY still applies to owners). Same step the earlier local harnesses used.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname, c.relkind, n.nspname AS sn FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('public','accounts','ssf','analytics','mis') AND c.relkind IN ('r','p','v','m','S')
             AND pg_get_userbyid(c.relowner) <> 'agrisync_app'
             AND NOT (c.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a','i'))) LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO agrisync_app',
      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, r.sn, r.relname);
  END LOOP;
  FOR r IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public','accounts','ssf','analytics','mis') LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO agrisync_app', r.nspname);
  END LOOP;
END $$;
