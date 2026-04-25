using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MakeGeminiPrimaryAiProviderConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE ssf.ai_provider_configs
                SET
                    default_provider = 'Gemini',
                    voice_provider = 'Gemini',
                    receipt_provider = 'Gemini',
                    patti_provider = 'Gemini',
                    modified_at_utc = NOW()
                WHERE
                    default_provider = 'Sarvam'
                    OR voice_provider IS NULL
                    OR voice_provider = 'Sarvam'
                    OR receipt_provider IS NULL
                    OR receipt_provider <> 'Gemini'
                    OR patti_provider IS NULL
                    OR patti_provider <> 'Gemini';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE ssf.ai_provider_configs
                SET
                    default_provider = 'Sarvam',
                    voice_provider = 'Sarvam',
                    receipt_provider = 'Gemini',
                    patti_provider = 'Gemini',
                    modified_at_utc = NOW()
                WHERE
                    default_provider = 'Gemini'
                    AND voice_provider = 'Gemini'
                    AND receipt_provider = 'Gemini'
                    AND patti_provider = 'Gemini';
                """);
        }
    }
}
