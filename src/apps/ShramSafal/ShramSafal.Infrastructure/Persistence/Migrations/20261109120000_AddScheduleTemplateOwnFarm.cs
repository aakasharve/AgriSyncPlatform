// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 lane SCH-OWN (founder D-74, D-82 = 3; register R30, R32) - a farm's OWN schedule names its FARM.
    ///
    /// <para><b>What it does.</b> (1) Adds the NULLABLE <c>own_farm_id</c> uuid to <c>ssf.schedule_templates</c> (null on every row that exists: no
    /// existing schedule is a farm's own), with a partial index over the rows that name a farm. (2) A foreign key to <c>ssf.farms ("Id")</c>,
    /// <c>ON DELETE RESTRICT</c>, by raw SQL (the shape of <c>20261102163914_AddWorkerIdentity</c>; <c>Farm</c> is keyed <c>FarmId</c> in the model, so EF
    /// would not name the column). A foreign-key check reads the parent row BYPASSING row-level security (E4): the application therefore asks
    /// the gate (<c>OwnScheduleGate</c>) BEFORE it sets <c>own_farm_id</c>, never after. (3) RE-KEYS the one-copy index: <c>ix_schedule_templates_derived_version</c>
    /// (<c>derived_from_template_id, version</c> where <c>derived_from_template_id IS NOT NULL</c>, which let a schedule be copied ONCE by anyone) is dropped and
    /// recreated under the SAME name with <c>AND own_farm_id IS NULL</c>, so a plain copy keeps the global one-copy rule (D3) and the old binary, which
    /// catches that index name, keeps answering 409 for it. (4) Adds <c>ix_schedule_templates_derived_own_farm</c> (<c>derived_from_template_id, own_farm_id</c> where
    /// both are set): ONE own copy of a source PER FARM, so two farms may each copy the same checked schedule into their own, and one farm only once.</para>
    ///
    /// <para><b>No row-level-security change.</b> <c>ssf.schedule_templates</c> is deliberately RLS-exempt (author-owned, application-gated;
    /// <c>RlsExemptionAllowlistTests</c>); the NO FORCE / FORCE lift of <c>AddWorkerIdentity</c> is for tables under FORCE RLS and is not needed here. The
    /// table keeps its grants (they cover the new column). Nothing is back-filled and no existing row changes.</para>
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> The currently deployed binary runs unchanged against the migrated schema
    /// (P11): it never names <c>own_farm_id</c>, so a row it writes has NULL there. Its clone, which inserts a copy with a NULL <c>own_farm_id</c>,
    /// meets the SAME-named, narrower index exactly as before, and its <c>TrySaveScheduleCopyAsync</c> catches that name and answers 409. It never
    /// lists or reads the column. What it cannot do is keep a farm's own schedule WALLED to the farm: an own row has scope Team, which the old
    /// viewer shows to everyone who works for the same OWNER (the farm's own schedule is then visible to that owner's other farms until the
    /// new binary serves). That is an exposure only after new rows exist, and only to that one owner's own people.</para>
    ///
    /// <para><b>Down() REFUSES, and changes nothing, while any row names a farm</b> (<see cref="DownRefusalSql"/>): taking the column away would
    /// turn a farm's own schedule into an ordinary Team schedule of its owner, listed to all his farms, and would let the recreated one-copy index
    /// fail on two farms' copies of one source. With no such row it drops the own-farm index, recreates <c>ix_schedule_templates_derived_version</c> as it was
    /// (the text of <c>20260420211528</c>), drops the foreign key, the partial index and the column. It destroys nothing.</para>
    /// </summary>
    public partial class AddScheduleTemplateOwnFarm : Migration
    {
        /// <summary>Up()'s foreign key. Tests execute this same text.</summary>
        internal const string AddForeignKeySql = @"
ALTER TABLE ssf.schedule_templates
    ADD CONSTRAINT fk_schedule_templates_own_farm FOREIGN KEY (own_farm_id) REFERENCES ssf.farms (""Id"") ON DELETE RESTRICT;
";

        /// <summary>Up()'s re-key of the one-copy index and the new one-own-copy-per-farm index. Tests execute this same text.</summary>
        internal const string RekeyIndexesSql = @"
DROP INDEX IF EXISTS ssf.ix_schedule_templates_derived_version;
CREATE UNIQUE INDEX ix_schedule_templates_derived_version
    ON ssf.schedule_templates (derived_from_template_id, version)
    WHERE derived_from_template_id IS NOT NULL AND own_farm_id IS NULL;
CREATE UNIQUE INDEX ix_schedule_templates_derived_own_farm
    ON ssf.schedule_templates (derived_from_template_id, own_farm_id)
    WHERE derived_from_template_id IS NOT NULL AND own_farm_id IS NOT NULL;
";

        /// <summary>Down()'s refusal. Tests execute this same text (as the app role: the table has no row-level security).</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_rows bigint;
BEGIN
    SELECT count(*) INTO v_rows FROM ssf.schedule_templates WHERE own_farm_id IS NOT NULL;
    IF v_rows > 0 THEN
        RAISE EXCEPTION 'Down refused: % schedule rows are a farm''s own schedule; rolling back would turn them into ordinary team schedules of their owner. Nothing changed.', v_rows;
    END IF;
END $$;
";

        /// <summary>Down()'s restore of the index as <c>20260420211528</c> made it.</summary>
        internal const string RestoreIndexSql = @"
DROP INDEX IF EXISTS ssf.ix_schedule_templates_derived_own_farm;
DROP INDEX IF EXISTS ssf.ix_schedule_templates_derived_version;
CREATE UNIQUE INDEX ix_schedule_templates_derived_version
    ON ssf.schedule_templates (derived_from_template_id, version)
    WHERE derived_from_template_id IS NOT NULL;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "own_farm_id",
                schema: "ssf",
                table: "schedule_templates",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_schedule_templates_own_farm_id",
                schema: "ssf",
                table: "schedule_templates",
                column: "own_farm_id",
                filter: "own_farm_id IS NOT NULL");

            migrationBuilder.Sql(AddForeignKeySql);
            migrationBuilder.Sql(RekeyIndexesSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently turns a farm's own schedule into its owner's ordinary team schedule. Raises (and so changes nothing).
            migrationBuilder.Sql(DownRefusalSql);
            migrationBuilder.Sql(RestoreIndexSql);

            migrationBuilder.Sql("ALTER TABLE ssf.schedule_templates DROP CONSTRAINT IF EXISTS fk_schedule_templates_own_farm;");

            migrationBuilder.DropIndex(
                name: "ix_schedule_templates_own_farm_id",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "own_farm_id",
                schema: "ssf",
                table: "schedule_templates");
        }
    }
}
