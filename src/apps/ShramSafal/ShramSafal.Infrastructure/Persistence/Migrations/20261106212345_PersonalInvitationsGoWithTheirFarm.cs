using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 fix round 1 (review L-10). A farm's personal
    /// invitations go with the farm: the foreign key from <c>ssf.farm_personal_invitations.farm_id</c> to <c>ssf.farms</c>
    /// becomes <c>ON DELETE CASCADE</c> (it was <c>RESTRICT</c>).
    /// <para><b>Why.</b> The only place a farm is ever deleted is the demo/test clear (<c>PurveshDemoSeeder.ClearPurveshDemoAsync</c>,
    /// refused in Production). It runs as <c>agrisync_app</c>, which holds NO <c>DELETE</c> on the invitations (revoked on
    /// purpose: the row is the farm's record of who it let in). With <c>RESTRICT</c> the clear failed with 23503 once the
    /// demo owner had made an invitation. PostgreSQL runs a cascade as the owner of the referencing table, so the app role
    /// still gets no <c>DELETE</c> right of its own — no grant changes here.</para>
    /// <para><b>Production data.</b> The constraint is dropped and added again; <c>ADD CONSTRAINT … FOREIGN KEY</c>
    /// re-checks the existing rows (each already references a live farm, as RESTRICT required). Product code never deletes
    /// a farm, so nothing changes for a real farm.</para>
    /// <para><b>Down()</b> puts <c>RESTRICT</c> back. It changes no row.</para>
    /// </summary>
    public partial class PersonalInvitationsGoWithTheirFarm : Migration
    {
        internal const string UpSql = @"
ALTER TABLE ssf.farm_personal_invitations DROP CONSTRAINT IF EXISTS ""FK_farm_personal_invitations_farms_farm_id"";
ALTER TABLE ssf.farm_personal_invitations ADD CONSTRAINT ""FK_farm_personal_invitations_farms_farm_id""
  FOREIGN KEY (farm_id) REFERENCES ssf.farms (""Id"") ON DELETE CASCADE;
";

        internal const string DownSql = @"
ALTER TABLE ssf.farm_personal_invitations DROP CONSTRAINT IF EXISTS ""FK_farm_personal_invitations_farms_farm_id"";
ALTER TABLE ssf.farm_personal_invitations ADD CONSTRAINT ""FK_farm_personal_invitations_farms_farm_id""
  FOREIGN KEY (farm_id) REFERENCES ssf.farms (""Id"") ON DELETE RESTRICT;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(UpSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(DownSql);
        }
    }
}
