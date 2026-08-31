// spec: 2026-08-25-prod-cutover-waves
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Sets <c>ssf.ai_provider_configs.transcriber_provider</c> to
    /// <c>'Sarvam'</c> so the two-stage voice pipeline actually runs:
    /// Sarvam transcribes the Marathi, Gemini buckets the transcript.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why this exists.</b> The founder's stated architecture (2026-08-25) is
    /// <i>"parsing only inside Sarvam, and auto-bucketing was using the Gemini …
    /// Sarvam is good at understanding Marathi; once it transcribes, Gemini can
    /// shift that transcript to auto buckets."</i> The code fully supports that
    /// shape. Production was not running it.
    /// </para>
    /// <para>
    /// <b>The defect, measured not inferred.</b>
    /// <c>AiOrchestrator.cs:258-259</c> resolves the pair from this table:
    /// <c>transcriberType = ParseProviderTypeOrDefault(config.TranscriberProvider, Gemini)</c>
    /// and <c>structurerType = …(config.StructurerProvider, Gemini)</c>. Then
    /// <c>:261-262</c> collapses the pipeline:
    /// <code>
    /// if (transcriberType == structurerType ||
    ///     !_transcribers.TryGetValue(transcriberType, out var transcriber))
    ///     -> delegate to the legacy single-call multimodal path
    /// </code>
    /// Production held <c>transcriber_provider = 'Gemini'</c> AND
    /// <c>structurer_provider = 'Gemini'</c> — both literal values, neither NULL,
    /// so no default applied. <b>They were equal, so the first limb was true and
    /// every request collapsed to one-shot Gemini before Sarvam was ever
    /// consulted.</b>
    /// </para>
    /// <para>
    /// <b>Proof it never ran.</b> <c>transcript_provider</c> is written ONLY
    /// inside the two-stage path (<c>AiOrchestrator.cs:446</c>). On production it
    /// is NULL across all 91 <c>ai_jobs</c> rows, and 0 rows carry a codemix or
    /// verbatim transcript. Every job records Gemini
    /// (<c>FallbackSucceeded</c>/<c>Succeeded</c>). The two-stage pipeline has
    /// never executed in production.
    /// </para>
    /// <para>
    /// <b>Why only this one column.</b> <c>structurer_provider</c> stays
    /// <c>'Gemini'</c> — that is the founder's design, not a bug. Stage 2 does not
    /// use <c>IStructurerProvider</c> (which has zero implementations); per
    /// <c>AiOrchestrator.cs:452-457</c> it routes the transcript through
    /// <c>IAiProvider.ParseVoiceAsync</c> with <c>mime=text/plain</c>, and Gemini
    /// IS registered there. So flipping the transcriber alone is sufficient and
    /// stage 2 keeps working. Verified before writing this, not after.
    /// </para>
    /// <para>
    /// <b>The transcriber exists.</b> <c>DependencyInjection.cs:490</c> registers
    /// exactly one <c>ITranscriberProvider</c> — <c>SarvamStreamingSttClient</c>.
    /// There is no Gemini transcriber anywhere in the repo, so
    /// <c>transcriber_provider = 'Gemini'</c> could never have resolved even if
    /// the two columns had differed. Sarvam STT (<c>saaras:v3</c>) was probed live
    /// on 2026-08-25 and returned HTTP 200 — it is alive; it was simply never
    /// being called.
    /// </para>
    /// <para>
    /// <b>Latent inconsistency, recorded not fixed.</b>
    /// <c>AiTranscribeStreamEndpoints.cs:182</c> defaults this same column to
    /// <c>Sarvam</c>, while <c>AiOrchestrator.cs:258</c> defaults it to
    /// <c>Gemini</c> — two paths, one column, opposite defaults. Irrelevant here
    /// because the stored value is explicit, but it is a real trap for whoever
    /// next reads a NULL. Not fixed in this cutover; out of scope.
    /// </para>
    /// <para>
    /// <b>Rollback (<c>RG4.5</c>).</b> The binary live on production today
    /// (<c>5e65d32b</c>) was checked and DOES contain
    /// <c>ParseVoiceTwoStageAsync</c>, the <c>ITranscriberProvider</c>
    /// registration and the collapse condition. So rolling the binary back while
    /// leaving this value forward does not crash — the old binary runs the same
    /// two-stage path. It does mean rollback silently activates a path that has
    /// never executed in production. That combination is <b>untested</b>, and is
    /// recorded as such rather than assumed benign. <c>Down()</c> restores
    /// <c>'Gemini'</c> exactly, which returns the collapse behaviour.
    /// </para>
    /// <para>
    /// <b>Ordering.</b> Dated 2026-08-25, its real authoring date, so it sorts
    /// after Wave 1's migrations even though it deploys first in Wave 0. EF
    /// applies pending migrations by id and skips applied ones, so Wave 1's
    /// earlier-dated set still applies normally afterwards. Back-dating it to
    /// tidy the sort order would be a lie about when it was written.
    /// </para>
    /// <para>
    /// <b>Registration.</b> The <c>[Migration]</c> attribute below is
    /// load-bearing and deliberate. <c>20260424124500_MakeGeminiPrimaryAiProviderConfig</c>
    /// is the one migration in this repo carrying no attribute and no Designer
    /// file, and it is the one migration that has never applied — EF cannot
    /// enumerate a class it does not see. This one is registered the same way the
    /// four working Designer-less migrations are.
    /// </para>
    /// </remarks>
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration("20260825130000_SetTranscriberProviderToSarvam")]
    public partial class SetTranscriberProviderToSarvam : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guarded on the exact collapse condition rather than blindly
            // overwriting: only rewrite the row when the transcriber currently
            // equals the structurer, which is what disables the pipeline. If an
            // operator has already split them, this is a no-op and their choice
            // stands.
            migrationBuilder.Sql(
                """
                UPDATE ssf.ai_provider_configs
                SET transcriber_provider = 'Sarvam',
                    modified_at_utc      = NOW()
                WHERE transcriber_provider IS NOT DISTINCT FROM structurer_provider;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Restores the collapse. Narrow on purpose: only rewind rows this
            // migration would have moved, so an operator who deliberately chose
            // a different transcriber afterwards is not silently reverted.
            migrationBuilder.Sql(
                """
                UPDATE ssf.ai_provider_configs
                SET transcriber_provider = structurer_provider,
                    modified_at_utc      = NOW()
                WHERE transcriber_provider = 'Sarvam'
                  AND structurer_provider = 'Gemini';
                """);
        }
    }
}
