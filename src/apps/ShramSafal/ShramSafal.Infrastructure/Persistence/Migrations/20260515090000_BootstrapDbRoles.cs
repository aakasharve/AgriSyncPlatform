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
            migrationBuilder.Sql(@"DO $$
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
END$$;

ALTER SCHEMA ssf OWNER TO agrisync_owner;
GRANT USAGE ON SCHEMA ssf TO agrisync_app, agrisync_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ssf TO agrisync_app;
GRANT SELECT ON ALL TABLES IN SCHEMA ssf TO agrisync_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ssf TO agrisync_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ssf
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agrisync_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ssf
  GRANT SELECT ON TABLES TO agrisync_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ssf
  GRANT USAGE, SELECT ON SEQUENCES TO agrisync_app;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"REASSIGN OWNED BY agrisync_owner TO postgres;
DROP OWNED BY agrisync_app;
DROP OWNED BY agrisync_readonly;
ALTER SCHEMA ssf OWNER TO postgres;
DROP ROLE IF EXISTS agrisync_app;
DROP ROLE IF EXISTS agrisync_readonly;
DROP ROLE IF EXISTS agrisync_owner;
");
        }
    }
}
