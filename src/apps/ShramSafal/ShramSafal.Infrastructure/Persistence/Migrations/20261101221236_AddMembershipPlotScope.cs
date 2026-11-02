using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 lane MU-4 (MU design §2 "Scope", §3 G2) — which plots one person's place on a farm covers.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE: two columns on <c>ssf.farm_memberships</c>,
    /// <c>plot_scope</c> NOT NULL DEFAULT 'AllPlots' and <c>scope_plot_ids</c> uuid[] NOT NULL DEFAULT '{}', and one CHECK
    /// (<c>ck_farm_memberships_plot_scope</c>: chosen plots name one or more plots, every other scope names none, and the
    /// scope is one of the three names). Every existing seat becomes "every plot, none chosen" — exactly what it reads
    /// today — and an older binary that inserts a seat without naming the columns writes exactly that, which the CHECK
    /// admits; the deployed binary never names the columns, so it runs unchanged against the migrated schema. No new table
    /// (so no new RLS policy, F8 does not arise): <c>p_tenant_farm_memberships</c> names the row, not the column.
    /// Enforcement is in application code (MU design §9), proved on real Postgres as agrisync_app.</para>
    ///
    /// <para><b>Fix pass 1 (M2), edited into this same migration (it has never run anywhere but a throwaway cluster).</b>
    /// ADDITIVE, two columns on each of <c>ssf.daily_logs</c> and <c>ssf.cost_entries</c>: <c>place_changed_at_utc</c>
    /// (NULL: "never moved to another place") and <c>former_plot_ids</c> uuid[] NOT NULL DEFAULT '{}' (every plot the record
    /// stood on before a move). Every existing row reads "never moved", which is what the pull assumed before; an older
    /// binary never names the columns, so its inserts take the defaults and its moves leave them as they were (a phone is
    /// then simply not told of that move — today's behaviour). No new table, no new policy.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops the CHECK and both columns: EVERY plot choice
    /// the primary account holder made ("these plots", "own work") is forgotten, and every such person covers every plot of
    /// his farm again — a WIDENING of what his phone receives on the next pull. The audit rows that recorded each change
    /// (MemberPlotScopeChanged: who, when, from and to) stay. Rolling back past this migration after a holder has used it is
    /// a founder decision. It also drops the four move columns: a later pull no longer tells a narrowed phone that a record
    /// moved off its plots (the record itself, its place and its history are untouched).</para>
    /// </summary>
    public partial class AddMembershipPlotScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "plot_scope",
                schema: "ssf",
                table: "farm_memberships",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "AllPlots");

            migrationBuilder.AddColumn<List<Guid>>(
                name: "scope_plot_ids",
                schema: "ssf",
                table: "farm_memberships",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddCheckConstraint(
                name: "ck_farm_memberships_plot_scope",
                schema: "ssf",
                table: "farm_memberships",
                sql: "(plot_scope = 'ChosenPlots') = (cardinality(scope_plot_ids) > 0) AND plot_scope IN ('AllPlots', 'ChosenPlots', 'OwnWork')");

            // fix pass 1 (M2) — where a record stood before a move, and when it moved.
            migrationBuilder.AddColumn<List<Guid>>(
                name: "former_plot_ids",
                schema: "ssf",
                table: "daily_logs",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<DateTime>(
                name: "place_changed_at_utc",
                schema: "ssf",
                table: "daily_logs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<List<Guid>>(
                name: "former_plot_ids",
                schema: "ssf",
                table: "cost_entries",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<DateTime>(
                name: "place_changed_at_utc",
                schema: "ssf",
                table: "cost_entries",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "former_plot_ids",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "place_changed_at_utc",
                schema: "ssf",
                table: "daily_logs");

            migrationBuilder.DropColumn(
                name: "former_plot_ids",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "place_changed_at_utc",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropCheckConstraint(
                name: "ck_farm_memberships_plot_scope",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "plot_scope",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "scope_plot_ids",
                schema: "ssf",
                table: "farm_memberships");
        }
    }
}
