// spec: data-principle-spine-2026-05-05
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// W1a role-bootstrap mini-spike (precedes Phase 02 of the Data Principle
    /// Spine). Creates the three database roles (<c>agrisync_owner</c>,
    /// <c>agrisync_app</c>, <c>agrisync_readonly</c>), transfers ownership of
    /// the <c>ssf</c> schema to <c>agrisync_owner</c>, and grants the
    /// least-privilege table / sequence privileges plus default privileges so
    /// future Phase 02+ migration objects inherit the correct grants.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Idempotent.</b> All role creation is guarded by
    /// <c>SELECT 1 FROM pg_roles</c> existence checks so re-running
    /// <c>dotnet ef database update</c> is a no-op on the role layer.
    /// </para>
    /// <para>
    /// <b>Dev passwords only.</b> The literal passwords
    /// <c>'dev_app_change_me'</c> / <c>'dev_ro_change_me'</c> are local-dev
    /// placeholders. Phase 03 owns the connection-string split and the
    /// production-secret handoff per the senior-architect Pre-Flight Brief
    /// (agentId ab6190f1ec1c4bb1d).
    /// </para>
    /// <para>
    /// <b>Down() is reversible (mini-spike).</b> Unlike Phase 01
    /// <c>AddProvenanceColumns</c> which is forward-only, this role-layer
    /// migration owns a real <see cref="Down"/> so local-dev iteration on the
    /// spike does not require a full <c>database drop</c>. Production
    /// rollback is still snapshot-restore per
    /// <c>_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md</c>.
    /// </para>
    /// </remarks>
    public partial class BootstrapDbRoles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // CI runs this migration against a Testcontainers Postgres image
            // whose superuser is NOT named "postgres" (it's typically "test"
            // or whatever the image default is). Hardcoding `FOR ROLE postgres`
            // breaks with `42704 role "postgres" does not exist`. Parameterize
            // via current_user inside a DO block + EXECUTE format so the
            // migration applies under whichever superuser ran it. Same fix
            // applies to Down()'s REASSIGN OWNED BY ... TO <runner>.
            migrationBuilder.Sql(@"DO $$
DECLARE
  v_runner text := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agrisync_owner') THEN
    CREATE ROLE agrisync_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agrisync_app') THEN
    CREATE ROLE agrisync_app LOGIN PASSWORD 'dev_app_change_me';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agrisync_readonly') THEN
    CREATE ROLE agrisync_readonly LOGIN PASSWORD 'dev_ro_change_me';
  END IF;

  EXECUTE 'ALTER SCHEMA ssf OWNER TO agrisync_owner';
  EXECUTE 'GRANT USAGE ON SCHEMA ssf TO agrisync_app, agrisync_readonly';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ssf TO agrisync_app';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA ssf TO agrisync_readonly';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ssf TO agrisync_app';

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA ssf GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agrisync_app',
    v_runner);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA ssf GRANT SELECT ON TABLES TO agrisync_readonly',
    v_runner);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA ssf GRANT USAGE, SELECT ON SEQUENCES TO agrisync_app',
    v_runner);
END$$;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Down() also parameterizes via current_user — see Up() comment.
            migrationBuilder.Sql(@"DO $$
DECLARE
  v_runner text := current_user;
BEGIN
  EXECUTE format('REASSIGN OWNED BY agrisync_owner TO %I', v_runner);
  EXECUTE 'DROP OWNED BY agrisync_app';
  EXECUTE 'DROP OWNED BY agrisync_readonly';
  EXECUTE format('ALTER SCHEMA ssf OWNER TO %I', v_runner);
END$$;

DROP ROLE IF EXISTS agrisync_app;
DROP ROLE IF EXISTS agrisync_readonly;
DROP ROLE IF EXISTS agrisync_owner;
");
        }
    }
}
