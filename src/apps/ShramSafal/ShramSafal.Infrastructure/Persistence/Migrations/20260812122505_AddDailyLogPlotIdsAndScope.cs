using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// LABOUR_PHASE2 migration ① — make the database able to record what the
    /// farmer actually said about location.
    /// </summary>
    /// <remarks>
    /// Founder decision O-1: "Entire Farm" is an intentional domain assertion —
    /// never an arbitrary plot, fake cycle, sentinel, "first available plot", or
    /// a NULL whose meaning has to be guessed. O-2: one shared engagement stays
    /// one engagement even when its context contains several plots.
    ///
    /// So the plot reference becomes a SET (<c>plot_ids</c>) and <c>scope</c>
    /// names the intent explicitly. <c>plot_id</c> is RETAINED and populated only
    /// when <c>scope='Plot'</c> — a compatibility projection that keeps every
    /// existing single-plot reader working untouched. <c>ck_daily_logs_scope</c>
    /// welds the two representations together so they cannot disagree.
    ///
    /// This is CLASSIFICATION, not backfill. We are not reconstructing missing
    /// farmer intent — we are classifying rows whose <c>plot_id</c> and
    /// <c>crop_cycle_id</c> already prove their meaning. Every pre-existing row
    /// was created through a write path that required both, so every one of them
    /// is plot-scoped by construction.
    ///
    /// The <c>Plot</c> branch of the CHECK carries two clauses beyond the plot
    /// count, and both exist to STOP this migration from quietly weakening a
    /// guarantee that already held (plan §M2, patched 2026-08-12):
    ///   • <c>crop_cycle_id IS NOT NULL</c> — <c>crop_cycle_id</c> has been
    ///     <c>NOT NULL</c> since the table was created
    ///     (20260222080909_AddAuditEvents:61) and every write path still
    ///     requires it for a plot-scoped log. Dropping the column-level
    ///     <c>NOT NULL</c> above is what lets a FARM-wide log have no cycle;
    ///     without this clause it would ALSO have silently made
    ///     <c>scope='Plot', crop_cycle_id=NULL</c> storable, and a row in that
    ///     shape is rejected by <c>AddLogTaskHandler</c> as
    ///     <c>CropCycleNotFound</c> forever with nothing anywhere saying the row
    ///     is malformed rather than the cycle deleted.
    ///   • <c>plot_ids[1] = plot_id</c> — <c>plot_id</c> is documented
    ///     (<c>DailyLog.cs</c>) and enforced in the domain
    ///     (<c>DailyLog.EnsureScopeInvariant</c>) as always EQUAL to the single
    ///     member of <c>plot_ids</c>. Without this clause the database accepted
    ///     <c>scope='Plot', plot_id=A, plot_ids={B}</c>, so a reader using
    ///     <c>plot_id</c> and a reader using <c>plot_ids</c> would return
    ///     DIFFERENT plots for the same log. Unreachable through EF (both
    ///     columns are written from one consistent entity); reachable through
    ///     any raw-SQL fixture or ops backfill. This clause is what makes
    ///     <c>plot_id</c> a compatibility PROJECTION rather than a second,
    ///     independent fact.
    /// Neither clause can reject a pre-existing row: both columns were
    /// <c>NOT NULL</c> until the statement above, and the classification UPDATE
    /// sets <c>plot_ids = ARRAY[plot_id]</c> from the row's own <c>plot_id</c>.
    ///
    /// Load-bearing, recorded so nobody "simplifies" it later: <c>plot_ids</c>'s
    /// column-level <c>NOT NULL</c> is what makes this CHECK work at all.
    /// <c>cardinality(NULL)</c> is <c>NULL</c>, the branch then evaluates to
    /// <c>NULL</c> rather than <c>FALSE</c>, and a CHECK treats <c>NULL</c> as
    /// SATISFIED — so a future <c>DROP NOT NULL</c> on <c>plot_ids</c> would
    /// silently disable the entire constraint while looking harmless because
    /// "the CHECK covers it". It does not.
    ///
    /// Hand-written rather than left as scaffolded operations, for two reasons
    /// the scaffolder cannot express:
    ///   • <c>ADD COLUMN ... NOT NULL</c> with no default fails on a populated
    ///     table, and EF's scaffolded <c>scope</c> default of <c>''</c> would
    ///     violate the CHECK on the very rows it is meant to classify;
    ///   • the scaffolded <c>Down()</c> restored NOT NULL with
    ///     <c>defaultValue: 00000000-0000-0000-0000-000000000000</c>, i.e. it
    ///     would have written a FABRICATED plot id over exactly the farm-wide
    ///     rows this migration exists to make honest (doctrine P4). The Down()
    ///     below refuses instead.
    ///
    /// Ordering: timestamp 20260812122505 sorts after the file-chain head
    /// 20260811112633_AddLabourCorrections, so it lands after all five August
    /// 2026 Labour migrations. Verified, not assumed — see the task report.
    ///
    /// Privilege note: <c>ssf.daily_logs</c> carries FORCE ROW LEVEL SECURITY
    /// (20260516130000). The UPDATE below is DML and is therefore subject to RLS
    /// for any role that is not a superuser / BYPASSRLS. Migrations run on the
    /// superuser connection here and in the integration chain. If they ever did
    /// not, the classification UPDATE would touch zero rows and the subsequent
    /// ADD CONSTRAINT would FAIL LOUDLY with 23514 rather than leave the table
    /// half-classified — fail-closed by construction.
    /// </remarks>
    public partial class AddDailyLogPlotIdsAndScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ssf.daily_logs
    ADD COLUMN plot_ids uuid[]     NOT NULL DEFAULT '{}',
    ADD COLUMN scope    varchar(10) NOT NULL DEFAULT 'Plot',
    ALTER COLUMN plot_id       DROP NOT NULL,
    ALTER COLUMN crop_cycle_id DROP NOT NULL;

UPDATE ssf.daily_logs SET plot_ids = ARRAY[plot_id], scope = 'Plot';

ALTER TABLE ssf.daily_logs
    ALTER COLUMN plot_ids DROP DEFAULT,
    ALTER COLUMN scope    DROP DEFAULT,
    ADD CONSTRAINT ck_daily_logs_scope CHECK (
        (scope = 'Plot'      AND cardinality(plot_ids) = 1  AND plot_id IS NOT NULL
                             AND crop_cycle_id IS NOT NULL  AND plot_ids[1] = plot_id)
     OR (scope = 'MultiPlot' AND cardinality(plot_ids) >= 2 AND plot_id IS NULL AND crop_cycle_id IS NULL)
     OR (scope = 'Farm'      AND cardinality(plot_ids) = 0  AND plot_id IS NULL AND crop_cycle_id IS NULL)
    );
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ssf.daily_logs DROP CONSTRAINT IF EXISTS ck_daily_logs_scope;

-- Plan section M, stated as code: rolling this migration back is safe ONLY
-- while every row still has a plot and a cycle. Once a farmer has recorded a
-- MultiPlot or Farm log, restoring NOT NULL can only be done by inventing a
-- plot id and a crop cycle for it. We refuse, loudly, and leave the schema
-- untouched. Rollback past that point requires a documented founder decision
-- about those specific rows, not a silent default.
DO $$
DECLARE
    v_plotless bigint;
BEGIN
    SELECT count(*) INTO v_plotless
    FROM ssf.daily_logs
    WHERE plot_id IS NULL OR crop_cycle_id IS NULL;

    IF v_plotless > 0 THEN
        RAISE EXCEPTION
            'Cannot roll back AddDailyLogPlotIdsAndScope: % ssf.daily_logs row(s) have no plot or no crop cycle. Restoring NOT NULL would fabricate a plot reference the farmer never gave. Decide what happens to those rows first.',
            v_plotless;
    END IF;
END $$;

ALTER TABLE ssf.daily_logs
    DROP COLUMN plot_ids,
    DROP COLUMN scope,
    ALTER COLUMN plot_id       SET NOT NULL,
    ALTER COLUMN crop_cycle_id SET NOT NULL;
");
        }
    }
}
