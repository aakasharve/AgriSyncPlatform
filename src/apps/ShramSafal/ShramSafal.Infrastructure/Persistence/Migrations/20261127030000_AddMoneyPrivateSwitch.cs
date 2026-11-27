// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract S2; founder 27 Nov follow-ups 1 and 2: "पैशांच्या नोंदी फक्त मला दिसू दे",
// a changed setting reaches new records only)
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// pilot lane PERM - the farm's money-private switch and the money stamp of a work record:
    /// <list type="bullet">
    /// <item><c>ssf.farms.money_private_to_holder boolean NOT NULL DEFAULT false</c>: while on, every NEW money record is seen by the registrant and its
    /// maker only. Every farm, old and new, is OFF.</item>
    /// <item><c>ssf.daily_logs.money_audience varchar(16) NULL</c> with <c>ck_daily_logs_money_audience</c> (NULL or 'OnlyMe'): a work record made while
    /// the switch was on keeps its money for the registrant and its maker. Every existing record reads NULL (its normal readers).</item>
    /// </list>
    /// Kept apart from <c>AddMemberWorkKinds</c> so each can be reviewed and rolled back alone.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE: two new columns, one new CHECK on the new column only. The currently
    /// deployed binary never names them, its INSERTs get the default (false) / NULL, so it runs unchanged against the migrated schema (P11). No policy,
    /// grant, index or other column changes: both columns ride the row security and the grants their tables already have. Rollback note for the deploy
    /// (named before it runs): once the switch has been USED, putting the previous binary back stops honouring <c>money_audience</c> (a work record's
    /// money would reach see-money seats again); money entries born OnlyMe stay private on any binary that has PRV.</para>
    ///
    /// <para><b>Down() REFUSES while any value is stored</b> (<see cref="DownRefusalSql"/>): a farm with the switch on, or a work record stamped
    /// private. Dropping them would silently open money a registrant made private. With nothing stored it drops the CHECK and the two columns and
    /// nothing else.</para>
    /// </summary>
    public partial class AddMoneyPrivateSwitch : Migration
    {
        /// <summary>Down()'s refusal (E8). Row security is switched off for the counts so a runner subject to it cannot see none where there are some.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_farms bigint;
    v_logs bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_farms FROM ssf.farms WHERE money_private_to_holder;
    SELECT count(*) INTO v_logs FROM ssf.daily_logs WHERE money_audience IS NOT NULL;
    IF v_farms > 0 OR v_logs > 0 THEN
        RAISE EXCEPTION 'Down refused: % farm(s) have money private to their registrant and % work record(s) keep their money private; rolling back would open that money to others. Turn the switch off and decide each private record deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_farms, v_logs;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "money_private_to_holder",
                schema: "ssf",
                table: "farms",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "money_audience",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_daily_logs_money_audience",
                schema: "ssf",
                table: "daily_logs",
                sql: "money_audience IS NULL OR money_audience = 'OnlyMe'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently opens money a registrant made private. Raises (and so changes nothing) while any value is stored.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropCheckConstraint(
                name: "ck_daily_logs_money_audience",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "money_private_to_holder",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "money_audience",
                schema: "ssf",
                table: "daily_logs");
        }
    }
}
