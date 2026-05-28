using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.11 / ADR-DS-014 §C —
    /// extend <c>ssf.user_consent_state</c> with the 4th + 5th consent
    /// toggles required by the V2 data-moat envelope:
    ///   - <c>verbatim_training_corpus boolean NOT NULL DEFAULT false</c>
    ///   - <c>english_translation_for_admin boolean NOT NULL DEFAULT false</c>
    ///
    /// <para>
    /// <b>Default flip 2026-05-28.</b> The english_translation_for_admin
    /// default was originally authored as <c>true</c> per ADR-DS-014 §C
    /// notice-and-opt-out posture. Per SARVAM_DEPLOY_READINESS gate B1
    /// conservative resolution 2026-05-28, the default was flipped to
    /// <c>false</c> in-place because this migration had not been applied
    /// to production yet. See
    /// <c>_COFOUNDER/Projects/AgriSync/Legal/Pending/SARVAM_ADMIN_TRANSLATION_DEFAULT_TRUE_COUNSEL_QUESTION_2026-05-28.md</c>.
    /// </para>
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Tables altered.</b>
    /// <list type="bullet">
    ///   <item><c>ssf.user_consent_state</c> — two ADD COLUMN statements with
    ///         <c>DEFAULT</c> clauses so existing rows backfill in place
    ///         (no UPDATE required).</item>
    /// </list>
    /// </para>
    /// <para>
    /// <b>Envelope deviation — consent_audit.consent_text_version.</b> The
    /// authoring envelope's SQL block requested
    /// <c>ALTER TABLE ssf.consent_audit ADD COLUMN consent_text_version
    /// varchar(16) NOT NULL DEFAULT 'v1.0'</c>. The envelope's preceding
    /// "if not present" clause acknowledged the column may already exist;
    /// it does — Phase 06.1's <c>20260519000000_ConsentDomain</c>
    /// migration created <c>consent_audit.consent_text_version</c> as
    /// <c>integer NOT NULL</c> (a monotonic counter the
    /// <c>UpdateConsentCommand</c> ConsentTextVersion already drives). We
    /// honor the envelope's "if not present" gate and skip the ADD —
    /// re-typing the existing int column to varchar would be a destructive
    /// data migration outside the scope of this slice and would also
    /// require a synchronous code change in <c>ConsentAuditEntry</c> (the
    /// property is typed as <c>int</c>) which the founder envelope did
    /// not author. The "track v2.0" intent surfaces semantically:
    /// <c>UpdateConsentCommand.ConsentTextVersion</c> = 2 maps to "v2.0"
    /// at the wire boundary; every existing user re-consents on next
    /// login as the consent UI bumps the value to 2 on the next save.
    /// </para>
    /// <para>
    /// <b>No RLS / grant change.</b> Both new columns inherit the existing
    /// table's grant boundary
    /// (<c>20260519000000_ConsentDomain</c>: SELECT/INSERT/UPDATE for
    /// <c>agrisync_app</c>, DELETE revoked). The RLS exemption allowlist
    /// (<c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c>) already
    /// covers <c>user_consent_state</c> via the Phase 06.1 entry — no
    /// architecture-test change required.
    /// </para>
    /// <para>
    /// <b>Reversibility.</b> Down() drops both columns. There is no
    /// supporting index or constraint to clean up; the columns are pure
    /// scalar toggles.
    /// </para>
    /// </remarks>
    public partial class ExtendConsentDomainForVerbatimAndAdminTranslation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "verbatim_training_corpus",
                schema: "ssf",
                table: "user_consent_state",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "english_translation_for_admin",
                schema: "ssf",
                table: "user_consent_state",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "english_translation_for_admin",
                schema: "ssf",
                table: "user_consent_state");

            migrationBuilder.DropColumn(
                name: "verbatim_training_corpus",
                schema: "ssf",
                table: "user_consent_state");
        }
    }
}
