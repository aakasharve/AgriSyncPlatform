using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-3.10) — founder decision 8 (2026-08-16):
    /// a spoken "no work today", with reason chips after.
    ///
    /// <para><b>One nullable column, <c>ssf.daily_logs.day_outcome</c>.</b> ADDITIVE by
    /// construction: no default, no backfill, no NOT NULL. Every log written before this
    /// migration keeps a NULL, <c>PersistedDayRootBuilder</c> omits the key when it is
    /// null, and a historical day therefore contributes exactly nothing (doctrine P4).
    /// <c>Down()</c> drops only this column. <c>classify-migration.py</c> classifies it
    /// <c>additive</c>.</para>
    ///
    /// <para><b>🛑 This is a FOURTH migration the MASTER change surface does not list</b>
    /// (it names three: wave-3.3, wave-3.12, Wave 4). It must be raised with the founder.
    /// There is no migration-free alternative: layers 4 and 5 of decision 8 — the
    /// normaliser and the scorer's root builder — are joined ONLY through the database
    /// (the normaliser's output goes to LedgerDerivationService, never to the scorer), and
    /// the sole existing table on that path is <c>disturbance_events</c>, which cannot
    /// carry the declaration. <c>DisturbanceEvent.Create</c> requires a non-empty reason,
    /// so a chip-less declaration stored there would be silently dropped — doctrine P9
    /// forbids an optional field rejecting a record — and a chip-bearing one would report
    /// the day as <c>blocked</c> rather than <c>rest</c>.</para>
    /// </summary>
    public partial class AddDailyLogDayOutcome : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "day_outcome",
                schema: "ssf",
                table: "daily_logs",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "day_outcome",
                schema: "ssf",
                table: "daily_logs");
        }
    }
}
