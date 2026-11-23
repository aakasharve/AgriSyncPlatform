// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7, "Reference schedules in the format"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 schedule slice 7 - reference schedules in format 2. (1) <c>ssf.schedule_templates.chain_id</c>: the chain every version of one reference schedule
    /// names (version 1 names itself), indexed. (2) <c>ssf.schedule_checks.checked_task_keys</c> / <c>checked_challenge_keys</c> / <c>content_hash</c>: a check of a
    /// version in the task format keeps every key the checker ticked and the content hash of the version he ticked them on.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Four NULLABLE columns with no default and one index. No table, policy, grant,
    /// trigger or row changes: schedule_templates keeps its user-keyed row security and schedule_checks its append-only grants (SELECT / INSERT,
    /// AddScheduleCheckAndStoredDays) - grants are per table, so the new columns are as append-only as the old. The currently deployed binary never names the new
    /// columns: its inserts leave them NULL, which is exactly what every row before the slice holds, so it runs unchanged against the migrated schema (P11).</para>
    ///
    /// <para><b>No person's id is added</b> (keys and a hash only), so erasure and export are unchanged: a check's checker stays where it was.</para>
    ///
    /// <para><b>Down</b> refuses (and so changes nothing) while any row holds a chain or any check holds ticked keys or a hash: rolling back would silently cut a
    /// version from its chain and a check from the content it was made on. Otherwise it drops exactly what Up() added.</para>
    /// </summary>
    public partial class AddScheduleReferenceFormat : Migration
    {
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_chains bigint;
    v_checks bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_chains FROM ssf.schedule_templates WHERE chain_id IS NOT NULL;
    SELECT count(*) INTO v_checks FROM ssf.schedule_checks
        WHERE checked_task_keys IS NOT NULL OR checked_challenge_keys IS NOT NULL OR content_hash IS NOT NULL;
    IF v_chains + v_checks > 0 THEN
        RAISE EXCEPTION 'Down refused: % schedule version(s) name a chain and % check(s) hold ticked task keys or a content hash, and rolling back would cut them. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_chains, v_checks;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "chain_id",
                schema: "ssf",
                table: "schedule_templates",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string[]>(
                name: "checked_challenge_keys",
                schema: "ssf",
                table: "schedule_checks",
                type: "text[]",
                nullable: true);

            migrationBuilder.AddColumn<string[]>(
                name: "checked_task_keys",
                schema: "ssf",
                table: "schedule_checks",
                type: "text[]",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "content_hash",
                schema: "ssf",
                table: "schedule_checks",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_schedule_templates_chain_id",
                schema: "ssf",
                table: "schedule_templates",
                column: "chain_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently cuts a version from its chain or a check from its content. Raises (and so changes nothing) while any exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropIndex(
                name: "ix_schedule_templates_chain_id",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "chain_id",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "checked_challenge_keys",
                schema: "ssf",
                table: "schedule_checks");

            migrationBuilder.DropColumn(
                name: "checked_task_keys",
                schema: "ssf",
                table: "schedule_checks");

            migrationBuilder.DropColumn(
                name: "content_hash",
                schema: "ssf",
                table: "schedule_checks");
        }
    }
}
