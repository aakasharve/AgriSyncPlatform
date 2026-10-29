using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec R-11 (b) (pre-launch repair, founder N-1) — <c>ssf.access_extension_projections</c>, the
    /// read-only view through which ShramSafal (DefaultEntitlementPolicy, GET /farms/mine) sees the
    /// server-managed pilot access extensions that Accounts owns in <c>accounts.access_extensions</c>
    /// (created by Accounts migration <c>20261027040015_AddAccessExtensions</c>, which production and
    /// the test chain apply BEFORE any ssf migration). Same seam as
    /// <c>20260418170936_AddSubscriptionProjection</c>: ShramSafal reads ssf only.
    ///
    /// <para>SELECT only, granted explicitly (default privileges are not relied on — see
    /// <c>20260831155124_GrantFieldOperatorWorkRowsToAppRole</c>). The view has no farm column and
    /// carries no farm data; the policy asks it only after the caller's membership was settled.</para>
    /// </summary>
    public partial class AddAccessExtensionProjection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE OR REPLACE VIEW ssf.access_extension_projections AS
                SELECT
                    e.access_extension_id  AS access_extension_id,
                    e.owner_account_id     AS owner_account_id,
                    e.reason               AS reason,
                    e.starts_at_utc        AS starts_at_utc,
                    e.ends_at_utc          AS ends_at_utc,
                    e.granted_by_user_id   AS granted_by_user_id,
                    e.created_at_utc       AS created_at_utc
                FROM accounts.access_extensions e;
            ");

            migrationBuilder.Sql(@"
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
                GRANT SELECT ON ssf.access_extension_projections TO agrisync_app;
            END IF;

            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
                GRANT SELECT ON ssf.access_extension_projections TO agrisync_readonly;
            END IF;
        END
        $$;
        ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW IF EXISTS ssf.access_extension_projections;");
        }
    }
}
