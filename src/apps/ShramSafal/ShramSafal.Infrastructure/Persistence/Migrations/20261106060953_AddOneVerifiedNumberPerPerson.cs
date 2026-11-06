using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 - lane WID fix pass 2 (review N3). Additive: two indexes on
    /// ssf.shram_person_phones and nothing else. ux_shram_person_phones_one_verified_per_person keeps ONE active verified
    /// number per person in the database itself, so two verifies at the same moment cannot both win (the loser is told
    /// to use the move). ix_shram_person_phones_number is the plain number index the AddWorkerIdentity configuration
    /// named but never created (it was folded into the unique per-number index). Down() drops exactly these two.
    /// It fails, changing nothing, if a person already holds two active verified numbers; check first with:
    /// SELECT person_id FROM ssf.shram_person_phones WHERE verified_at_utc IS NOT NULL AND released_at_utc IS NULL
    /// AND phone_e164 IS NOT NULL GROUP BY person_id HAVING count(*) > 1;
    /// </summary>
    public partial class AddOneVerifiedNumberPerPerson : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_shram_person_phones_number",
                schema: "ssf",
                table: "shram_person_phones",
                column: "phone_e164");

            migrationBuilder.CreateIndex(
                name: "ux_shram_person_phones_one_verified_per_person",
                schema: "ssf",
                table: "shram_person_phones",
                column: "person_id",
                unique: true,
                filter: "verified_at_utc IS NOT NULL AND released_at_utc IS NULL AND phone_e164 IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_shram_person_phones_number",
                schema: "ssf",
                table: "shram_person_phones");

            migrationBuilder.DropIndex(
                name: "ux_shram_person_phones_one_verified_per_person",
                schema: "ssf",
                table: "shram_person_phones");
        }
    }
}
