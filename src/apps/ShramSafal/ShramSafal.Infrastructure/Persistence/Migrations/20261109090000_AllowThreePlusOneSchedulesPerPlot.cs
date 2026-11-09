// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-3)
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - a plot-season follows up to 3 outside schedules plus 1 of his own, each in
    /// its own place.
    ///
    /// <para><b>What it does.</b> (1) Adds the NULLABLE <c>slot</c> smallint to <c>ssf.schedule_subscriptions</c> (0 = his own,
    /// 1..3 = outside). (2) Back-fills it in the same migration: every NULL <c>origin</c> becomes <c>'Outside'</c> (a choice made
    /// before L8b-1F); every Active <c>Own</c> row takes place 0; Active <c>Outside</c> rows take places 1, 2, 3 by
    /// <c>adopted_at_utc, id</c> within their <c>(plot_id, crop_cycle_id)</c>. Rows that are not Active keep a NULL place.
    /// (3) Adds two CHECKs (<c>ck_sched_sub_slot_range</c>: NULL or 0..3; <c>ck_sched_sub_slot_origin</c>: a row with a place has an
    /// origin and is <c>Own</c> exactly when its place is 0). (4) DROPS the one-Active-per-<c>(plot_id, crop_key, crop_cycle_id)</c>
    /// index <c>ux_sched_sub_active</c> (invariant I-14, which 3 + 1 replaces). (5) Creates two partial unique indexes over Active rows:
    /// <c>ux_sched_sub_active_slot</c> (<c>plot_id, crop_cycle_id, slot</c>: the database itself holds 3 + 1, so two phones racing for
    /// the last place cannot both win) and <c>ux_sched_sub_active_template</c> (<c>plot_id, crop_cycle_id, schedule_template_id</c>:
    /// never the same schedule twice). "At most one of his own" needs no third index: his own is place 0, and place 0 is unique.</para>
    ///
    /// <para><b>The back-fill REFUSES, and writes nothing, when</b> a plot-season already has more than 3 Active outside rows, more than
    /// 1 Active own row, or the same schedule Active twice (only a crop-name change can make that: I-14 was keyed on the crop name).
    /// The deploy then stops until a person decides which to keep; nothing is chosen for him. The back-fill lifts FORCE row-level
    /// security on this table for its own duration when the runner cannot bypass RLS (production migrates as <c>agrisync_app</c>, a
    /// non-bypass owner; the shape of <c>20261102163914_AddWorkerIdentity</c>): without the lift it would see no rows, and both the
    /// back-fill and the refusal would silently pass. It counts while the lift is in effect.</para>
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> The currently deployed binary runs unchanged against the migrated
    /// schema (P11) <b>while no plot-season follows two or more schedules; after that a binary-only rollback would act on an arbitrary row</b>
    /// (the old binary reads one Active row per plot-season with no ORDER BY): it names neither <c>slot</c> nor a place, and the CHECKs accept a NULL place; its own adopt is still guarded by its
    /// own one-active read, so it inserts a second Active row for a plot-season only when none exists. There is deliberately NO
    /// "every Active row has a place" CHECK, for that reason; the new handlers always set a place. No policy or grant changes: the table
    /// keeps its row-level security and its table-level grants (they cover the new column, which is written only on INSERT).</para>
    ///
    /// <para><b>Down()</b> first REFUSES (raises, nothing changed) while any plot-season follows two or more schedules, because the
    /// recreated I-14 index could not hold them and a rollback would have to end one of them silently (E8). With at most one schedule
    /// followed per plot-season it drops the two indexes, the two CHECKs and <c>slot</c>, and recreates <c>ux_sched_sub_active</c> as
    /// it was. It DESTROYS only which place each schedule held. It does NOT revert the <c>origin</c> back-fill: a NULL origin and
    /// <c>'Outside'</c> read the same. L8b-1F's <c>Down()</c> must run after this one (its <c>origin</c> column is read by this
    /// migration's CHECK).</para>
    /// </summary>
    public partial class AllowThreePlusOneSchedulesPerPlot : Migration
    {
        /// <summary>Up()'s data step. Tests execute this same text (as the app role, under FORCE RLS).</summary>
        internal const string BackfillSql = @"
DO $$
DECLARE
    can_bypass_rls boolean;
    v_bad          bigint;
    v_unslotted    bigint;
BEGIN
    SELECT rolsuper OR rolbypassrls INTO can_bypass_rls FROM pg_roles WHERE rolname = current_user;
    IF NOT can_bypass_rls THEN
        ALTER TABLE ssf.schedule_subscriptions NO FORCE ROW LEVEL SECURITY;
    END IF;

    UPDATE ssf.schedule_subscriptions SET origin = 'Outside' WHERE origin IS NULL;

    SELECT count(*) INTO v_bad FROM (
        SELECT plot_id, crop_cycle_id FROM ssf.schedule_subscriptions WHERE state = 0
         GROUP BY plot_id, crop_cycle_id
        HAVING count(*) FILTER (WHERE origin = 'Outside') > 3
            OR count(*) FILTER (WHERE origin = 'Own') > 1
            OR count(*) <> count(DISTINCT schedule_template_id)) x;

    IF v_bad = 0 THEN
        UPDATE ssf.schedule_subscriptions SET slot = 0 WHERE state = 0 AND origin = 'Own' AND slot IS NULL;
        WITH ranked AS (
            SELECT id, row_number() OVER (PARTITION BY plot_id, crop_cycle_id ORDER BY adopted_at_utc, id) AS rn
              FROM ssf.schedule_subscriptions WHERE state = 0 AND origin = 'Outside')
        UPDATE ssf.schedule_subscriptions s SET slot = r.rn FROM ranked r WHERE s.id = r.id AND s.slot IS NULL;
    END IF;

    -- Counted while the lift is in effect, or the count is RLS-filtered.
    SELECT count(*) INTO v_unslotted FROM ssf.schedule_subscriptions WHERE state = 0 AND slot IS NULL;
    IF NOT can_bypass_rls THEN
        ALTER TABLE ssf.schedule_subscriptions FORCE ROW LEVEL SECURITY;
    END IF;

    IF v_bad > 0 THEN
        RAISE EXCEPTION '3 + 1: % plot-seasons already follow more than 3 outside schedules, more than 1 of their own, or one schedule twice. Refusing; nothing changed.', v_bad;
    END IF;
    IF v_unslotted <> 0 THEN
        RAISE EXCEPTION '3 + 1: % Active subscriptions were left without a place. Refusing.', v_unslotted;
    END IF;
END $$;
";

        /// <summary>Down()'s refusal. Tests execute this same text (as the app role, under FORCE RLS).</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    can_bypass_rls boolean;
    v_two          bigint;
BEGIN
    SELECT rolsuper OR rolbypassrls INTO can_bypass_rls FROM pg_roles WHERE rolname = current_user;
    IF NOT can_bypass_rls THEN
        ALTER TABLE ssf.schedule_subscriptions NO FORCE ROW LEVEL SECURITY;
    END IF;

    -- exactly what the recreated one-active index (plot_id, crop_key, crop_cycle_id WHERE state = 0) would refuse
    SELECT count(*) INTO v_two FROM (
        SELECT plot_id, crop_key, crop_cycle_id FROM ssf.schedule_subscriptions WHERE state = 0
         GROUP BY plot_id, crop_key, crop_cycle_id HAVING count(*) > 1) x;

    IF NOT can_bypass_rls THEN
        ALTER TABLE ssf.schedule_subscriptions FORCE ROW LEVEL SECURITY;
    END IF;

    IF v_two > 0 THEN
        RAISE EXCEPTION 'Down refused: % plot-seasons follow two or more schedules; rolling back would have to end one of them. Nothing changed.', v_two;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<short>(
                name: "slot",
                schema: "ssf",
                table: "schedule_subscriptions",
                type: "smallint",
                nullable: true);

            migrationBuilder.Sql(BackfillSql);

            migrationBuilder.AddCheckConstraint(
                name: "ck_sched_sub_slot_range",
                schema: "ssf",
                table: "schedule_subscriptions",
                sql: "slot IS NULL OR slot BETWEEN 0 AND 3");

            migrationBuilder.AddCheckConstraint(
                name: "ck_sched_sub_slot_origin",
                schema: "ssf",
                table: "schedule_subscriptions",
                sql: "slot IS NULL OR (origin IS NOT NULL AND ((origin = 'Own') = (slot = 0)))");

            migrationBuilder.DropIndex(
                name: "ux_sched_sub_active",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.CreateIndex(
                name: "ux_sched_sub_active_slot",
                schema: "ssf",
                table: "schedule_subscriptions",
                columns: new[] { "plot_id", "crop_cycle_id", "slot" },
                unique: true,
                filter: "state = 0");

            migrationBuilder.CreateIndex(
                name: "ux_sched_sub_active_template",
                schema: "ssf",
                table: "schedule_subscriptions",
                columns: new[] { "plot_id", "crop_cycle_id", "schedule_template_id" },
                unique: true,
                filter: "state = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently ends a followed schedule. Raises (and so changes nothing) while any plot-season follows two or more.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropIndex(
                name: "ux_sched_sub_active_slot",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.DropIndex(
                name: "ux_sched_sub_active_template",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_sched_sub_slot_origin",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_sched_sub_slot_range",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.DropColumn(
                name: "slot",
                schema: "ssf",
                table: "schedule_subscriptions");

            migrationBuilder.CreateIndex(
                name: "ux_sched_sub_active",
                schema: "ssf",
                table: "schedule_subscriptions",
                columns: new[] { "plot_id", "crop_key", "crop_cycle_id" },
                unique: true,
                filter: "state = 0");
        }
    }
}
