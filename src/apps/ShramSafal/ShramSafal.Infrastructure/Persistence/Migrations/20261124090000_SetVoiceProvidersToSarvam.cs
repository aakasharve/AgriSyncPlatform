// spec: voice-instant-phase-a-2026-11-23
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Sets BOTH halves of the voice provider pair on <c>ssf.ai_provider_configs</c> to <c>'Sarvam'</c>: speech-to-text
    /// (<c>transcriber_provider</c>, Saaras) and sorting (<c>structurer_provider</c>, Sarvam 105B). Data only: no
    /// column, table, index, policy or grant changes, so the model snapshot does not change (and, like the other
    /// data-only migrations here, it has no Designer file).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why.</b> Founder's order 2026-11-23/24: voice is Sarvam only, Gemini never sees a recording. The settings
    /// said otherwise, and said different things in different places: production was set to transcriber
    /// <c>Sarvam</c> / structurer <c>Gemini</c> by <c>20260825130000_SetTranscriberProviderToSarvam</c>, while the test
    /// database held <c>Gemini</c> / <c>Gemini</c> (a row created from the code default, after the earlier migration had
    /// run on an empty table). Equal values used to collapse the voice call to the one-call path, so the two
    /// environments did not even run the same code. Gemini cannot take a voice note any more (it answers
    /// <c>CanHandle(voice) = false</c>), so a <c>'Gemini'</c> in either column was never true; this makes the row say
    /// what the code does, and (with the orchestrator change in the same lane, which collapses only when no
    /// transcriber port is registered) makes every environment run the same two-stage path.
    /// </para>
    /// <para>
    /// <b>Up()</b> rewrites the row only when it is not already Sarvam / Sarvam, so a second run changes nothing, and it
    /// touches <c>modified_at_utc</c> because <c>GetProviderConfigAsync</c> reads the most recently modified row.
    /// </para>
    /// <para>
    /// <b>Down()</b> restores the state the migration chain had before this one: transcriber <c>Sarvam</c>, structurer
    /// <c>Gemini</c> (what <c>20260825130000</c> left, and what production held). It only rewinds a row that is
    /// Sarvam / Sarvam, so a pair chosen differently afterwards is not silently reverted. It cannot recover the
    /// <c>Gemini</c> / <c>Gemini</c> the test database held, because that state never came from this chain; running
    /// <c>20260825130000</c>'s own Down() after this one returns it to that.
    /// </para>
    /// <para>
    /// <b>Rollback of the binary.</b> The binary before this lane runs a Sarvam / Sarvam row as the one-call path
    /// (equal values collapse), so rolling the API back with this value forward is safe: it behaves as the test stack
    /// did before.
    /// </para>
    /// </remarks>
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration(MigrationId)]
    public partial class SetVoiceProvidersToSarvam : Migration
    {
        public const string MigrationId = "20261124090000_SetVoiceProvidersToSarvam";

        public const string UpSql =
            """
            UPDATE ssf.ai_provider_configs
            SET transcriber_provider = 'Sarvam',
                structurer_provider  = 'Sarvam',
                modified_at_utc      = NOW()
            WHERE transcriber_provider IS DISTINCT FROM 'Sarvam'
               OR structurer_provider  IS DISTINCT FROM 'Sarvam';
            """;

        public const string DownSql =
            """
            UPDATE ssf.ai_provider_configs
            SET structurer_provider = 'Gemini',
                modified_at_utc     = NOW()
            WHERE transcriber_provider = 'Sarvam'
              AND structurer_provider  = 'Sarvam';
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(UpSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(DownSql);
        }
    }
}
