using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// LABOUR_PHASE2 migration ③ — give the farmer's own note somewhere to live.
    /// </summary>
    /// <remarks>
    /// Founder decision O-3: <i>"If the product lets a farmer enter a note, it must
    /// survive capture → write → read-back → clean-device reconstruction."</i>
    ///
    /// The note has been on the wire since Labour V1 Task 5 —
    /// <c>LabourItemSchema.notes</c> in <c>create_daily_log.zod.ts</c>, sent on
    /// every save by <c>logSyncMutationService</c> — and <c>CreateDailyLogHandler</c>
    /// dropped it on the floor because there was no column. This is that column.
    /// One nullable <c>text</c> on the engagement, not a notes subsystem.
    ///
    /// <para><b>Purely additive.</b> Nullable, no default, no backfill, no
    /// constraint, no index, no RLS change — <c>ssf.labour_assignments</c>'s two
    /// policies (<c>p_tenant_labour_assignments</c>,
    /// <c>p_user_select_labour_assignments</c>) are EXISTS-joins to
    /// <c>ssf.daily_logs</c> and name no column of this table, so they are
    /// untouched. Every pre-existing row reads <c>NULL</c>, which is exactly true:
    /// nobody's note was ever stored, so we know of none. Inventing anything else
    /// here would be a fabricated farmer utterance (doctrine P4).</para>
    ///
    /// <para><b>The <c>Down()</c> REFUSES rather than destroying.</b> Same standard
    /// of care as migration ① (<c>20260812122505_AddDailyLogPlotIdsAndScope</c>),
    /// for the mirror-image reason. ① refused because rolling back would have had
    /// to INVENT a plot; this one refuses because rolling back would DESTROY the
    /// farmer's own words — the single thing O-3 exists to preserve — silently and
    /// with no backup anywhere in this system. When no note has ever been written
    /// the column carries nothing and the rollback is genuinely lossless, so it
    /// proceeds. Once notes exist, dropping them is a decision a person has to
    /// make, not a side effect of a rollback.</para>
    ///
    /// <para>Ordering: timestamp <c>20260813053429</c> sorts after the file-chain
    /// head <c>20260812122505_AddDailyLogPlotIdsAndScope</c> (migration ①), which
    /// itself lands after all five August 2026 Labour V1 migrations. Verified
    /// against the folder listing, not assumed.</para>
    /// </remarks>
    public partial class AddLabourAssignmentNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "notes",
                schema: "ssf",
                table: "labour_assignments",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- O-3 stated as code: a note the farmer typed must survive the round trip. A
-- DROP COLUMN here deletes every one of them, unrecoverably — there is no
-- backfill job, no re-derive endpoint and no second copy anywhere in this
-- system. So we refuse loudly and leave the schema untouched. Rolling back past
-- the first real note requires a documented decision about those notes, not a
-- silent DROP.
DO $$
DECLARE
    v_with_notes bigint;
BEGIN
    SELECT count(*) INTO v_with_notes
    FROM ssf.labour_assignments
    WHERE notes IS NOT NULL;

    IF v_with_notes > 0 THEN
        RAISE EXCEPTION
            'Cannot roll back AddLabourAssignmentNotes: % ssf.labour_assignments row(s) carry a farmer-written note. Dropping the column deletes them permanently. Decide what happens to those notes first.',
            v_with_notes;
    END IF;
END $$;
");

            migrationBuilder.DropColumn(
                name: "notes",
                schema: "ssf",
                table: "labour_assignments");
        }
    }
}
