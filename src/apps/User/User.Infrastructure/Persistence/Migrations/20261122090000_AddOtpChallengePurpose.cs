using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace User.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: trusted-control-room-2026-11-20 — CR-3 fix wave S-A1 (AU-F1, FR-I2, FR-I3; founder decision D-159). Door
    /// codes are kept apart from farmer codes in the one code table, <c>public.otp_challenges</c>.
    /// <list type="bullet">
    /// <item><c>purpose</c> smallint NOT NULL DEFAULT 1: 1 = the farmer app's SMS sign-in, 2 = the control room's own
    /// door. The farmer routes count and check purpose-1 codes only; the door counts and checks purpose-2 codes only.</item>
    /// <item>The one-pending-code-per-phone index becomes one pending code per phone PER DOOR, so a door code never
    /// replaces a farmer's pending code and the other way round.</item>
    /// <item>A CHECK keeps the column to the two known values.</item>
    /// </list>
    /// <para><b>Existing rows (P11):</b> additive only. Every row written before this migration, and every row an older
    /// binary writes after it (it names no purpose), takes the constant default 1 and stays a farmer-app code, so an
    /// installed phone app and a rolling deploy keep working. No row is rewritten.</para>
    /// <para><b>Down()</b> ends any still-pending door code first (under the old index a door code and a farmer code for
    /// the same number could not both be pending), then restores the one-per-phone index and drops the column.</para>
    /// </summary>
    public partial class AddOtpChallengePurpose : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<short>(
                name: "purpose",
                schema: "public",
                table: "otp_challenges",
                type: "smallint",
                nullable: false,
                defaultValue: (short)1);

            migrationBuilder.DropIndex(
                name: "ux_otp_challenges_pending_per_phone",
                schema: "public",
                table: "otp_challenges");

            migrationBuilder.CreateIndex(
                name: "ux_otp_challenges_pending_per_phone_purpose",
                schema: "public",
                table: "otp_challenges",
                columns: new[] { "phone_number_normalized", "purpose" },
                unique: true,
                filter: "status = 1");

            migrationBuilder.Sql(@"
ALTER TABLE public.otp_challenges
    ADD CONSTRAINT ck_otp_challenges_purpose
    CHECK (purpose IN (1, 2));
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE public.otp_challenges DROP CONSTRAINT IF EXISTS ck_otp_challenges_purpose;");

            migrationBuilder.Sql(@"
UPDATE public.otp_challenges
   SET status = 3, consumed_at_utc = now()
 WHERE purpose = 2 AND status = 1;
");

            migrationBuilder.DropIndex(
                name: "ux_otp_challenges_pending_per_phone_purpose",
                schema: "public",
                table: "otp_challenges");

            migrationBuilder.DropColumn(
                name: "purpose",
                schema: "public",
                table: "otp_challenges");

            migrationBuilder.CreateIndex(
                name: "ux_otp_challenges_pending_per_phone",
                schema: "public",
                table: "otp_challenges",
                column: "phone_number_normalized",
                unique: true,
                filter: "status = 1");
        }
    }
}
