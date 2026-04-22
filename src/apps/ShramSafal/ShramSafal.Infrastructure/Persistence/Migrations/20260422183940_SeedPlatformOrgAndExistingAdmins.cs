using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SeedPlatformOrgAndExistingAdmins : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The Platform organization is a singleton. Fixed, well-known ID so
            // tests, ops scripts, and appsettings can reference it symbolically.
            // Sentinels:
            //   00000000-0000-0000-0000-00000000a000  = Platform org id
            //   00000000-0000-0000-0000-000000000000  = wildcard farm id (PlatformWildcard)
            //   00000000-0000-0000-0000-000000000000  = system actor for the initial grant
            //
            // Admin-user memberships are NOT seeded here (migration cannot read
            // IConfiguration — appsettings.Admins[]). Post-migration ops script
            // seed-platform-admins.sql does that for every environment. This
            // migration only guarantees the Platform org + wildcard scope rows
            // exist. Idempotent — ON CONFLICT + WHERE NOT EXISTS.
            migrationBuilder.Sql(@"
INSERT INTO ssf.organizations (id, name, type, created_at_utc, is_active)
VALUES ('00000000-0000-0000-0000-00000000a000', 'AgriSync Platform', 0, NOW(), true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ssf.organization_farm_scopes
    (id, organization_id, farm_id, source, granted_by_user_id, granted_at_utc, is_active)
SELECT gen_random_uuid(),
       '00000000-0000-0000-0000-00000000a000',
       '00000000-0000-0000-0000-000000000000',
       3 /* PlatformWildcard */,
       '00000000-0000-0000-0000-000000000000',
       NOW(),
       true
WHERE NOT EXISTS (
    SELECT 1 FROM ssf.organization_farm_scopes
    WHERE organization_id = '00000000-0000-0000-0000-00000000a000'
      AND source = 3
      AND is_active = true
);

INSERT INTO mis.effective_org_farm_scope (org_id, farm_id, source, refreshed_at_utc)
VALUES ('00000000-0000-0000-0000-00000000a000',
        '00000000-0000-0000-0000-000000000000',
        'PlatformWildcard',
        NOW())
ON CONFLICT (org_id, farm_id) DO NOTHING;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM mis.effective_org_farm_scope
 WHERE org_id = '00000000-0000-0000-0000-00000000a000'
   AND source = 'PlatformWildcard';

DELETE FROM ssf.organization_farm_scopes
 WHERE organization_id = '00000000-0000-0000-0000-00000000a000'
   AND source = 3;

DELETE FROM ssf.organizations
 WHERE id = '00000000-0000-0000-0000-00000000a000';
");
        }
    }
}
