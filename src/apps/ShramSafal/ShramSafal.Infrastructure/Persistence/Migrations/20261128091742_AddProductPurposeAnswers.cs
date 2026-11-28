using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Part 03 B4 (founder's final design, 28 Nov 2026) — his answer to "what was this product for?" rides the existing
    /// append-only <c>ssf.question_events</c> row, one per product of a record (the server's key
    /// <c>product.purpose:{slot}:{event}</c> under the existing unique index <c>ux_question_events_log_question</c>). Three
    /// nullable columns, nothing else: <c>answer_mode</c> (chip / voice, P8), <c>answer_code</c> (a chip's fixed code) and
    /// <c>product_name</c> (the product's name copied from the stored record when he answered).
    ///
    /// <para><b>No grant or policy change.</b> The table is already append-only by privilege (REVOKE UPDATE, DELETE, TRUNCATE
    /// from agrisync_app) with direct farm_id FORCE RLS; a new column inherits both. Every existing row reads NULL in all three,
    /// which is exactly "not a product-purpose answer" (P11: an older phone's row is unchanged).</para>
    ///
    /// <para><b>Rollback (E8).</b> The previous binary runs against this schema unchanged (it maps none of the three columns).
    /// <c>Down</c> drops the three columns: the answers' words, keys and askers stay on their rows; only how he answered, the
    /// chip's code and the copied product name would be lost.</para>
    /// </summary>
    public partial class AddProductPurposeAnswers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "answer_code",
                schema: "ssf",
                table: "question_events",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "answer_mode",
                schema: "ssf",
                table: "question_events",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "product_name",
                schema: "ssf",
                table: "question_events",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "answer_code",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "answer_mode",
                schema: "ssf",
                table: "question_events");

            migrationBuilder.DropColumn(
                name: "product_name",
                schema: "ssf",
                table: "question_events");
        }
    }
}
