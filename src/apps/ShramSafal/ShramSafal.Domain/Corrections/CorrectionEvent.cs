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
