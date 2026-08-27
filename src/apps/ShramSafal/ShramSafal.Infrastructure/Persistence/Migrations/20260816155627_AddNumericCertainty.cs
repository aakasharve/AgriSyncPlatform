using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-3.12) — spec Ruling 5 (2026-08-15):
    /// every number remembers how sure the farmer was.
    ///
    /// <para><b>Eight nullable columns across four child tables</b> — the dose on
    /// <c>application_input_items</c>, the water on <c>irrigation_entries</c>, the cost on
    /// <c>labour_assignments</c> and <c>machinery_usages</c>. Each pair is a certainty
    /// (<c>reported</c> / <c>approximate</c> / <c>unknown</c>) plus the farmer's own words
    /// for that number.</para>
    ///
    /// <para><b>Additive by construction.</b> No default, no backfill, no NOT NULL. Every
    /// row written before this migration keeps NULL, which reads as "not asked, not
    /// stated" — never as <c>Reported</c>, because claiming a farmer was confident about a
    /// number nobody asked him about is exactly the fabrication doctrine P4 forbids.
    /// <c>Down()</c> drops only these eight columns.</para>
    ///
    /// <para><b>Doctrine P8 — certainty is a DIFFERENT AXIS from provenance.</b> These are
    /// separate columns rather than a fifth member of <c>FieldProvenance</c>
    /// (<c>spoken | confirmed | derived | assumed</c>): "अंदाजे ५०० मिली" is spoken AND
    /// approximate, and neither axis may be overloaded to carry the other.</para>
    ///
    /// <para><b>MANUAL HALF ONLY.</b> The voice path is <c>BLOCKED — Gate C</c> and is not
    /// in this migration's scope: emitting certainty at parse time needs an AI prompt
    /// change, a prompt-registry bump and a golden-set delta, and a route for a
    /// confirm-time correction to reach the server (<c>AiJob.NormalizedResultJson</c> is
    /// write-once at parse). Founder decision required. No prompt file was touched.</para>
    /// </summary>
    public partial class AddNumericCertainty : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "cost_certainty",
                schema: "ssf",
                table: "machinery_usages",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "cost_spoken_text",
                schema: "ssf",
                table: "machinery_usages",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "cost_certainty",
                schema: "ssf",
                table: "labour_assignments",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "cost_spoken_text",
                schema: "ssf",
                table: "labour_assignments",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "water_certainty",
                schema: "ssf",
                table: "irrigation_entries",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "water_spoken_text",
                schema: "ssf",
                table: "irrigation_entries",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "dose_certainty",
                schema: "ssf",
                table: "application_input_items",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "dose_spoken_text",
                schema: "ssf",
                table: "application_input_items",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "cost_certainty",
                schema: "ssf",
                table: "machinery_usages");

            migrationBuilder.DropColumn(
                name: "cost_spoken_text",
                schema: "ssf",
                table: "machinery_usages");

            migrationBuilder.DropColumn(
                name: "cost_certainty",
                schema: "ssf",
                table: "labour_assignments");

            migrationBuilder.DropColumn(
                name: "cost_spoken_text",
                schema: "ssf",
                table: "labour_assignments");

            migrationBuilder.DropColumn(
                name: "water_certainty",
                schema: "ssf",
                table: "irrigation_entries");

            migrationBuilder.DropColumn(
                name: "water_spoken_text",
                schema: "ssf",
                table: "irrigation_entries");

            migrationBuilder.DropColumn(
                name: "dose_certainty",
                schema: "ssf",
                table: "application_input_items");

            migrationBuilder.DropColumn(
                name: "dose_spoken_text",
                schema: "ssf",
                table: "application_input_items");
        }
    }
}
