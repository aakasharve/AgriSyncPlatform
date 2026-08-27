using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Gives <c>ssf.cost_entries</c> somewhere to record WHICH WAY the money
    /// moved, plus the line detail the client had been holding on the phone.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Every column is nullable and NONE has a default — deliberately.</b>
    /// A <c>DEFAULT 'Expense'</c> on <c>direction</c> would be a one-line way to
    /// make the schema look tidy and would assert, for every row already in the
    /// table, that the farmer said it was money spent. He did not say that: the
    /// column did not exist when those rows were written, and income travelled
    /// down the same wire as expense, so some of them are sales. NULL is the
    /// only honest value for them and the read path is required to keep saying
    /// "not stated" rather than pick the likelier side.
    /// </para>
    /// <para>
    /// <b>There is deliberately NO BACKFILL.</b> There is nothing to derive one
    /// from. The sign of <c>amount</c> is not a direction (it is always
    /// positive — the domain rejects anything else) and <c>category_id</c> is
    /// not a direction either. Any backfill would be a guess written into a
    /// column that reads like a statement.
    /// </para>
    /// <para>
    /// <b>Additive and reversible.</b> Seven <c>ADD COLUMN … NULL</c> against an
    /// existing table: no rewrite, no lock beyond the catalog update, no data
    /// touched. <c>Down</c> drops exactly what <c>Up</c> added.
    /// </para>
    /// </remarks>
    public partial class AddCostEntryDirectionAndLineDetail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "client_attachment_ids_json",
                schema: "ssf",
                table: "cost_entries",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "direction",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "payment_mode",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "quantity",
                schema: "ssf",
                table: "cost_entries",
                type: "numeric(18,3)",
                precision: 18,
                scale: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "unit",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "unit_price",
                schema: "ssf",
                table: "cost_entries",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "vendor_name",
                schema: "ssf",
                table: "cost_entries",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "client_attachment_ids_json",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "direction",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "payment_mode",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "quantity",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "unit",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "unit_price",
                schema: "ssf",
                table: "cost_entries");

            migrationBuilder.DropColumn(
                name: "vendor_name",
                schema: "ssf",
                table: "cost_entries");
        }
    }
}
