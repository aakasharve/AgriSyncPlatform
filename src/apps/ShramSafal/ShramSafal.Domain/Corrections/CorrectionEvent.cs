// spec: correctionevent-server-persistence
namespace ShramSafal.Domain.Corrections;

public enum CorrectionTrigger
{
    EditUI,
    LowConfidenceReview,
    ManualFlag
}

public sealed class CorrectionEvent
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }

    /// <summary>
    /// The <c>AiJob</c> this correction is about, when it is known.
    /// </summary>
    /// <remarks>
    /// §P0.4 — NULLABLE on purpose. The client used to mint a fresh random
    /// UUID whenever it had no real job id, which matched no <c>AiJob</c>: the
    /// golden-set worker joins on this column and silently skipped every such
    /// row, while the column still looked like a genuine link. "Unknown" is
    /// now recorded as unknown instead of being invented.
    /// </remarks>
    public Guid? OriginalParseId { get; private set; }

    /// <summary>AI-suggested draft, JSON — structured signal only, no speech.</summary>
    public string OriginalParseRaw { get; private set; } = string.Empty;

    /// <summary>Farmer-corrected draft, JSON — structured signal only, no speech.</summary>
    public string CorrectedParse { get; private set; } = string.Empty;

    /// <summary>
    /// Storage cap for <see cref="PromptVersion"/>. Declared on the aggregate so
    /// the EF mapping and the use-case validator read the SAME number - a cap
    /// declared in only one of the two places is exactly what turned an
    /// out-of-contract value into a 500 instead of a 400.
    ///
    /// <para>256, not 20 and not 64. This column does NOT store the short "v1"
    /// label the sibling Provenance columns carry; it stores what
    /// <c>AiPromptLineage.ResolvePromptVersion</c> returns, which is the modular
    /// prompt MANIFEST built by <c>AiPromptTemplateRegistry.BuildVersionString</c>:
    /// <c>base:{v};output:{v};buckets:{8 id:version pairs};disturbance:{v};hash:{16 hex}</c>.
    /// With all 8 required buckets at v1 that is 158 characters TODAY, and 169 if
    /// every module reaches a two-digit version. 64 - the widest prompt_version
    /// anywhere in ssf - would still raise 22001 on every single row.</para>
    /// </summary>
    public const int PromptVersionMaxLength = 256;

    /// <summary>Storage cap for <see cref="PromptContentHash"/> - 64-hex SHA-256.</summary>
    public const int PromptContentHashMaxLength = 64;

    /// <summary>Storage cap for <see cref="Locale"/>.</summary>
    public const int LocaleMaxLength = 10;

    public string PromptVersion { get; private set; } = string.Empty;

    /// <summary>
    /// 64-char SHA-256 hex of the prompt content used for the parse.
    /// §P0.4 — the only tamper-evident prompt identifier, and it was being
    /// discarded on the way in. <c>PromptVersion</c> is a label anyone can
    /// reuse; this is the thing that pins what the model was actually asked.
    /// </summary>
    public string? PromptContentHash { get; private set; }

    public string Locale { get; private set; } = string.Empty;
    public CorrectionTrigger Trigger { get; private set; }
    public DateTimeOffset CapturedAtUtc { get; private set; }

    private CorrectionEvent() { }

    /// <summary>
    /// Records a correction. <b>The two draft payloads are redacted here</b>,
    /// inside the aggregate, so there is exactly one way into this table and
    /// it cannot carry a transcript. See <see cref="TranscriptRedaction"/>.
    /// </summary>
    public static CorrectionEvent Record(
        Guid userId,
        Guid? originalParseId,
        string originalParseRaw,
        string correctedParse,
        string promptVersion,
        string locale,
        CorrectionTrigger trigger,
        string? promptContentHash = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(originalParseRaw);
        ArgumentException.ThrowIfNullOrWhiteSpace(correctedParse);
        ArgumentException.ThrowIfNullOrWhiteSpace(promptVersion);

        return new CorrectionEvent
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            OriginalParseId = originalParseId,
            // §P0.4 — the ONLY constructor, so this is the only door into
            // ssf.correction_events. Redacting here means no caller, present
            // or future, can persist the farmer's words by forgetting to.
            OriginalParseRaw = TranscriptRedaction.Redact(originalParseRaw),
            CorrectedParse = TranscriptRedaction.Redact(correctedParse),
            PromptVersion = promptVersion,
            PromptContentHash = string.IsNullOrWhiteSpace(promptContentHash)
                ? null
                : promptContentHash,
            Locale = string.IsNullOrWhiteSpace(locale) ? "mr-IN" : locale,
            Trigger = trigger,
            CapturedAtUtc = DateTimeOffset.UtcNow
        };
    }
}
