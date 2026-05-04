// spec: correctionevent-server-persistence
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Adds the <c>ssf.correction_events</c> table for server-side
    /// persistence of user corrections to AI-parsed AgriLog fields.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Each row records one user correction: the original parse JSON,
    /// the corrected parse JSON, the prompt version that produced the
    /// original parse, the locale, and the trigger that caused the
    /// correction (EditUI / LowConfidenceReview / ManualFlag).
    /// </para>
    /// <para>
    /// <b>Idempotency.</b> <see cref="Up"/> uses
    /// <c>CREATE TABLE IF NOT EXISTS</c> / <c>CREATE INDEX IF NOT EXISTS</c>
    /// so a second run is a no-op — same discipline as
    /// <c>20260504000000_WtlV0Entities</c>.
    /// </para>
    /// <para>
    /// <b>Forward-only.</b> <see cref="Down"/> raises an exception
    /// rather than dropping the table. Production rollback is via DB
    /// snapshot restore per
    /// <c>_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md</c>;
    /// local-dev cleanup is via <c>dotnet ef database drop</c>.
    /// </para>
    /// </remarks>
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration("20260504010000_AddCorrectionEvent")]
    public partial class AddCorrectionEvent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS ssf.correction_events (
                    "Id"                uuid         PRIMARY KEY,
                    user_id             uuid         NOT NULL,
                    original_parse_id   uuid         NOT NULL,
                    original_parse_raw  jsonb        NOT NULL,
                    corrected_parse     jsonb        NOT NULL,
                    prompt_version      varchar(20)  NOT NULL,
                    locale              varchar(10)  NOT NULL,
                    trigger             varchar(30)  NOT NULL,
                    captured_at_utc     timestamptz  NOT NULL
                );
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS ix_correction_events_user_id
                    ON ssf.correction_events (user_id);
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS ix_correction_events_prompt_version
                    ON ssf.correction_events (prompt_version);
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS ix_correction_events_captured_at_utc
                    ON ssf.correction_events (captured_at_utc);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    RAISE EXCEPTION 'AddCorrectionEvent is forward-only. Roll back via DB snapshot restore (RDS_PROVISIONING.md) or `dotnet ef database drop` for local dev.';
                END;
                $$;
                """);
        }
    }
}
