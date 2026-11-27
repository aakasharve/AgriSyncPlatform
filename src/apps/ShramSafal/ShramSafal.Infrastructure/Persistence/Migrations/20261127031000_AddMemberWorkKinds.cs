// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract S1; founder 27 Nov: "kinds of work he may record")
using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// pilot lane PERM - the kinds of work one person may RECORD on one farm: <c>ssf.farm_memberships.allowed_work_kinds text[] NULL</c> (the record's
    /// own bucket names; NULL = every kind) with <c>ck_farm_memberships_work_kinds</c> (NULL, or one or more of the six that can be limited), and
    /// <c>work_kinds_changed_at_utc timestamptz NULL</c> (when the set last changed; the late-arrival window is judged against it). Kept apart from
    /// <c>AddMoneyPrivateSwitch</c> so each can be reviewed and rolled back alone.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE: two nullable columns with no default and no back-fill, one CHECK on the new
    /// column only. Every existing seat reads NULL = every kind, exactly as today (P9, P11). The currently deployed binary never names them, so it runs
    /// unchanged against the migrated schema. No policy, grant, index or other column changes: both columns ride <c>p_tenant_farm_memberships</c> and the
    /// grants the table already has. Rollback note for the deploy (named before it runs): once a limit has been SET, putting the previous binary back
    /// stops enforcing it (the limited person records every kind again); nothing is lost or exposed.</para>
    ///
    /// <para><b>Down() REFUSES while any seat is limited</b> (<see cref="DownRefusalSql"/>): dropping the column would silently lift a limit a registrant
    /// set. With no seat limited it drops the CHECK and the two columns and nothing else.</para>
    /// </summary>
    public partial class AddMemberWorkKinds : Migration
    {
        /// <summary>Down()'s refusal (E8). Row security is switched off for the count so a runner subject to it cannot see no seat where there is one.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_limited bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_limited FROM ssf.farm_memberships WHERE allowed_work_kinds IS NOT NULL;
    IF v_limited > 0 THEN
        RAISE EXCEPTION 'Down refused: % seat(s) are limited to some kinds of work by their farm''s registrant, and rolling back would lift those limits. Clear them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_limited;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<string>>(
                name: "allowed_work_kinds",
                schema: "ssf",
                table: "farm_memberships",
                type: "text[]",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "work_kinds_changed_at_utc",
                schema: "ssf",
                table: "farm_memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_farm_memberships_work_kinds",
                schema: "ssf",
                table: "farm_memberships",
                sql: "allowed_work_kinds IS NULL OR (cardinality(allowed_work_kinds) >= 1 AND allowed_work_kinds <@ ARRAY['cropActivities','irrigation','inputs','labour','machinery','activityExpenses']::text[])");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently lifts a limit a registrant set. Raises (and so changes nothing) while any seat is limited.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropCheckConstraint(
                name: "ck_farm_memberships_work_kinds",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "allowed_work_kinds",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "work_kinds_changed_at_utc",
                schema: "ssf",
                table: "farm_memberships");
        }
    }
}
