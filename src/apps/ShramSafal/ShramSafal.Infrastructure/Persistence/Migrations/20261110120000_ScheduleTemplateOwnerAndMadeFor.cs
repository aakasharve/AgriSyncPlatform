// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-c)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 lane SCH-OWN-c (founder D-133 withdrawn, D-136, D-137; register F218, F220, F222, F223, F225, F227, F228) - a schedule belongs to the PERSON.
    ///
    /// <para><b>What it does.</b> (1) Adds to <c>ssf.schedule_templates</c> the NULLABLE <c>owner_user_id</c> uuid - the owner (<c>ssf.farms.owner_user_id</c>)
    /// of the farm a person's own schedule was made on, copied by the application from the farm row the gate trusted, never from a request body - with a
    /// partial index over the rows that have one; and four NULLABLE made-for tag columns, <c>variety</c>, <c>soil_type</c>, <c>region_code</c>, <c>climate</c>
    /// (varchar(40) list codes; <c>region_code</c> is shaped like the legacy <c>crop_schedule_templates.region_code</c>). (2) CONVERTS SOWN-a's rows: a row
    /// that named its farm (<c>own_farm_id</c>) becomes its farm's OWNER's own (<see cref="ConvertSql"/>) - exactly the new meaning; zero rows anywhere real
    /// (F220, D-136). It is NOT total over every state SOWN-a's schema allowed: SOWN-a allowed one own copy PER FARM, so an owner of two farms could hold
    /// two own copies of one source, which the new one-copy-per-person rule cannot hold. Up() looks for that FIRST (<see cref="UpRefusalSql"/>) and REFUSES
    /// on purpose, with words, changing nothing - it never drops or merges a row (production holds none). (3) RE-KEYS the one-copy indexes (<see cref="RekeyIndexesSql"/>):
    /// <c>ix_schedule_templates_derived_version</c> keeps its NAME (the deployed pre-SCH-OWN binary catches that name; its NULL-owner inserts meet it exactly
    /// as before, E8) and now covers rows with no owner; <c>ix_schedule_templates_derived_owner</c> (<c>derived_from_template_id, owner_user_id</c>) keeps ONE
    /// own copy of a source PER PERSON (an owner of two farms copies a checked schedule into his own once and follows it on both; a second copy answers
    /// 409 <c>ScheduleCopy.Conflict</c>). (4) DROPS <c>own_farm_id</c>, its foreign key <c>fk_schedule_templates_own_farm</c> and its index: nothing is
    /// deployed and no row exists (F220), two "own" columns would make every reader choose which one is truth, and F218 ("a NULL owner is never Own")
    /// must have ONE column to read.</para>
    ///
    /// <para><b>The order of Up() matters.</b> Postgres drops any index whose predicate names a column WITH the column: <c>DROP COLUMN own_farm_id</c> would
    /// silently take <c>ix_schedule_templates_derived_version</c> (SOWN-a's predicate <c>AND own_farm_id IS NULL</c>) with it. So: add the columns and the owner
    /// index; convert; re-key the two indexes to <c>owner_user_id</c>; only then drop the foreign key, the index and the column.</para>
    ///
    /// <para><b>No foreign key on <c>owner_user_id</c>.</b> No <c>ssf</c> table has one to <c>public.users</c> (another bounded context's table;
    /// <c>farms.owner_user_id</c> has none either). E4: a foreign key proves existence, not permission - the gate is the defence, the id is only ever copied
    /// from a farm row the gate trusted, and erasure never deletes a user row (ErasureWorker: KEEP, an opaque id, like <c>created_by_user_id</c>).</para>
    ///
    /// <para><b>No row-level-security change.</b> <c>ssf.schedule_templates</c> is deliberately RLS-exempt (author-owned, application-gated;
    /// <c>RlsExemptionAllowlistTests</c>). The table keeps its grants (they cover the new columns).</para>
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> The currently deployed binary (pre-SCH-OWN) runs unchanged against the migrated
    /// schema (P11): it never names any of these columns, so a row it writes has NULL in all of them (never Own, F218); its clone meets the SAME-named
    /// one-copy index and answers 409 as before; it never lists or reads the columns. Fix-forward note: once owned rows exist there is no binary rollback
    /// past SCH-OWN-c - SOWN-a's delegate branch and <c>own_farm_id</c> writer are gone with the merged code, and x1's old binary writes NULL-owner versions
    /// (a version of an own chain written by it would be an ordinary Team row, M010).</para>
    ///
    /// <para><b>Down() REFUSES, and changes nothing, while any row has an owner or a tag</b> (<see cref="DownRefusalSql"/>): rolling back would turn a
    /// person's own schedule into an ordinary team schedule and lose what it was made for. With no such row it rebuilds EXACTLY SOWN-a's shape, in this
    /// order: the <c>own_farm_id</c> column and its index, SOWN-a's foreign key (its own <see cref="AddScheduleTemplateOwnFarm.AddForeignKeySql"/> text,
    /// by reference, so the rebuilt shape cannot drift), the per-owner index dropped and SOWN-a's own re-key (<see cref="AddScheduleTemplateOwnFarm.RekeyIndexesSql"/>)
    /// run again - BEFORE <c>owner_user_id</c> is dropped - then the owner index and the five columns. It destroys nothing: it runs only with no owned or
    /// tagged row.</para>
    /// </summary>
    public partial class ScheduleTemplateOwnerAndMadeFor : Migration
    {
        /// <summary>
        /// Up()'s first statement (review P002): refuses, with words and BEFORE anything changes, when the conversion would make two rows one person's own copy
        /// of the same source - SOWN-a allowed one own copy per FARM, so an owner of farms A and C could hold (S, farm A) and (S, farm C), and the
        /// one-own-copy-per-person index could not be built. Never drops or merges a row. Production holds none (F220). Tests execute the migration for real.
        /// </summary>
        internal const string UpRefusalSql = @"
DO $$
DECLARE
    v_owners bigint;
BEGIN
    SELECT count(*) INTO v_owners FROM (
        SELECT t.derived_from_template_id, f.owner_user_id
        FROM ssf.schedule_templates t
        JOIN ssf.farms f ON f.""Id"" = t.own_farm_id
        WHERE t.own_farm_id IS NOT NULL AND t.derived_from_template_id IS NOT NULL
        GROUP BY t.derived_from_template_id, f.owner_user_id
        HAVING count(*) > 1
    ) clash;
    IF v_owners > 0 THEN
        RAISE EXCEPTION 'Up refused: % owner(s) hold more than one own copy of the same schedule, one on each of their farms (SOWN-a allowed one per farm; the rule now is one per person). They are the rows of ssf.schedule_templates that share derived_from_template_id and the owner of own_farm_id. Keep one copy and withdraw or delete the other for each of them, then run the migration again. Nothing was changed.', v_owners;
    END IF;
END $$;
";

        /// <summary>Up()'s conversion of SOWN-a's farm-own rows: "a farm's own" becomes "its owner's own". Zero rows anywhere real. Tests execute this same text.</summary>
        internal const string ConvertSql = @"
UPDATE ssf.schedule_templates t
    SET owner_user_id = f.owner_user_id
    FROM ssf.farms f
    WHERE t.own_farm_id IS NOT NULL AND f.""Id"" = t.own_farm_id;
";

        /// <summary>
        /// Up()'s re-key of the one-copy index (SAME name: the deployed binary catches it) to rows with no owner, and the one-own-copy-per-PERSON index.
        /// Must run BEFORE <c>own_farm_id</c> is dropped (Postgres would drop the predicate index with the column). Tests execute this same text.
        /// </summary>
        internal const string RekeyIndexesSql = @"
DROP INDEX IF EXISTS ssf.ix_schedule_templates_derived_own_farm;
DROP INDEX IF EXISTS ssf.ix_schedule_templates_derived_version;
CREATE UNIQUE INDEX ix_schedule_templates_derived_version
    ON ssf.schedule_templates (derived_from_template_id, version)
    WHERE derived_from_template_id IS NOT NULL AND owner_user_id IS NULL;
CREATE UNIQUE INDEX ix_schedule_templates_derived_owner
    ON ssf.schedule_templates (derived_from_template_id, owner_user_id)
    WHERE derived_from_template_id IS NOT NULL AND owner_user_id IS NOT NULL;
";

        /// <summary>Down()'s refusal. Tests execute this same text (as the app role: the table has no row-level security).</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_rows bigint;
BEGIN
    SELECT count(*) INTO v_rows FROM ssf.schedule_templates
    WHERE owner_user_id IS NOT NULL OR variety IS NOT NULL OR soil_type IS NOT NULL OR region_code IS NOT NULL OR climate IS NOT NULL;
    IF v_rows > 0 THEN
        RAISE EXCEPTION 'Down refused: % schedule rows are a person''s own schedule or say what they were made for; rolling back would turn a person''s own schedule into an ordinary team schedule and lose what it was made for. Nothing changed.', v_rows;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 0. refuse on purpose (with words) a state the new rule cannot hold, before anything changes
            migrationBuilder.Sql(UpRefusalSql);

            // 1. the new columns (all nullable: every existing row is nobody's own and says nothing) and the owner index
            migrationBuilder.AddColumn<Guid>(
                name: "owner_user_id",
                schema: "ssf",
                table: "schedule_templates",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "variety",
                schema: "ssf",
                table: "schedule_templates",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "soil_type",
                schema: "ssf",
                table: "schedule_templates",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "region_code",
                schema: "ssf",
                table: "schedule_templates",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "climate",
                schema: "ssf",
                table: "schedule_templates",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_schedule_templates_owner_user_id",
                schema: "ssf",
                table: "schedule_templates",
                column: "owner_user_id",
                filter: "owner_user_id IS NOT NULL");

            // 2. convert SOWN-a's farm-own rows (zero anywhere real) to their farm's owner
            migrationBuilder.Sql(ConvertSql);

            // 3. re-key the two indexes BEFORE the column they named is dropped
            migrationBuilder.Sql(RekeyIndexesSql);

            // 4. drop SOWN-a's foreign key, index and column
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently turns a person's own schedule into an ordinary team schedule. Raises (and so changes nothing) while any row has an owner or a tag.
            migrationBuilder.Sql(DownRefusalSql);

            // Rebuild SOWN-a's shape, by reference to its own text (never a copy): the column and its index, the foreign key, the per-farm re-key.
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

            migrationBuilder.Sql(AddScheduleTemplateOwnFarm.AddForeignKeySql);
            migrationBuilder.Sql("DROP INDEX IF EXISTS ssf.ix_schedule_templates_derived_owner;");
            migrationBuilder.Sql(AddScheduleTemplateOwnFarm.RekeyIndexesSql);

            // Only now the owner index and the five columns (the re-key above no longer names owner_user_id).
            migrationBuilder.DropIndex(
                name: "ix_schedule_templates_owner_user_id",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "owner_user_id",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "variety",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "soil_type",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "region_code",
                schema: "ssf",
                table: "schedule_templates");

            migrationBuilder.DropColumn(
                name: "climate",
                schema: "ssf",
                table: "schedule_templates");
        }
    }
}
