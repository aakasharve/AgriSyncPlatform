namespace ShramSafal.Domain.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.3 — re-transcription audit ledger
/// (Safeguard S4). Captures every transcript produced for a given audio
/// content hash so a later replay against a new model/prompt version is
/// auditable and idempotent.
/// </summary>
/// <remarks>
/// <para>
/// A row is uniquely identified by
/// <c>(AudioContentHash, TranscriptProvider, TranscriptModelVersion,
/// TranscriptMode)</c>. The same audio replayed against the same
/// (provider, model, mode) triple never produces a second row — the
/// caller upserts on the unique key.
/// </para>
/// <para>
/// <see cref="PromptVersion"/> and <see cref="ExtractorCodeSha"/> are
/// nullable on purpose: a pure transcription call (e.g. raw Sarvam STT)
/// has no prompt or extractor, whereas a transcript produced by a
/// downstream re-extractor (e.g. Gemini structurer producing a new
/// codemix line) carries both.
/// </para>
/// <para>
/// Per ADR-DS-015 the table is immutable (append-only); the entity
/// exposes a factory only — no mutators.
/// </para>
/// </remarks>
public sealed class TranscriptHistory
{
    private TranscriptHistory() { } // EF Core

    private TranscriptHistory(
        Guid id,
        string audioContentHash,
        string transcriptProvider,
        string transcriptModelVersion,
        string transcriptMode,
        string transcriptText,
        string? promptVersion,
        string? extractorCodeSha,
        DateTime producedAtUtc)
    {
        Id = id;
        AudioContentHash = audioContentHash;
        TranscriptProvider = transcriptProvider;
        TranscriptModelVersion = transcriptModelVersion;
        TranscriptMode = transcriptMode;
        TranscriptText = transcriptText;
        PromptVersion = promptVersion;
        ExtractorCodeSha = extractorCodeSha;
        ProducedAtUtc = producedAtUtc;
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// SHA-256 of the raw audio bytes (64 hex characters). Stable across
    /// providers and re-runs; the audit key for "which audio did we
    /// transcribe".
    /// </summary>
    public string AudioContentHash { get; private set; } = string.Empty;

    /// <summary>
    /// Provider that produced this transcript (e.g. <c>Sarvam</c>,
    /// <c>Gemini</c>). Free-form string so new providers register
    /// without a code change.
    /// </summary>
    public string TranscriptProvider { get; private set; } = string.Empty;

    /// <summary>
    /// Provider's model version (e.g. <c>saaras-v3</c>,
    /// <c>gemini-3.1-flash-lite-preview</c>). Stamped at call time.
    /// </summary>
    public string TranscriptModelVersion { get; private set; } = string.Empty;

    /// <summary>
    /// Sarvam STT mode (<c>codemix</c> | <c>verbatim</c> |
    /// <c>translit</c> | <c>translate</c> | <c>transcribe</c>) or the
    /// canonical mode string for non-Sarvam providers (e.g.
    /// <c>multimodal</c> for Gemini voice fallback). Stored required
    /// (never null) so the uniqueness key is deterministic.
    /// </summary>
    public string TranscriptMode { get; private set; } = string.Empty;

    public string TranscriptText { get; private set; } = string.Empty;

    /// <summary>
    /// Prompt-registry version of the prompt that produced this
    /// transcript, or null when the producer is a raw STT (no prompt).
    /// </summary>
    public string? PromptVersion { get; private set; }

    /// <summary>
    /// Git SHA of the extractor code (e.g. the Gemini structurer
    /// adapter) that produced this transcript, or null when the
    /// producer is a raw STT.
    /// </summary>
    public string? ExtractorCodeSha { get; private set; }

    public DateTime ProducedAtUtc { get; private set; }

    /// <summary>
    /// Factory. Validates that the audio-content hash, provider, model
    /// version, mode, and transcript text are non-empty. Trims optional
    /// fields and stores null for empty/whitespace. Generates a new
    /// <see cref="Guid"/> when <paramref name="id"/> is
    /// <see cref="Guid.Empty"/>.
    /// </summary>
    public static TranscriptHistory Create(
        Guid id,
        string audioContentHash,
        string transcriptProvider,
        string transcriptModelVersion,
        string transcriptMode,
        string transcriptText,
        string? promptVersion,
        string? extractorCodeSha,
        DateTime producedAtUtc)
    {
        if (string.IsNullOrWhiteSpace(audioContentHash))
        {
            throw new ArgumentException("audioContentHash is required.", nameof(audioContentHash));
        }

        if (string.IsNullOrWhiteSpace(transcriptProvider))
        {
            throw new ArgumentException("transcriptProvider is required.", nameof(transcriptProvider));
        }

        if (string.IsNullOrWhiteSpace(transcriptModelVersion))
        {
            throw new ArgumentException("transcriptModelVersion is required.", nameof(transcriptModelVersion));
        }

        if (string.IsNullOrWhiteSpace(transcriptMode))
        {
            throw new ArgumentException("transcriptMode is required.", nameof(transcriptMode));
        }

        if (string.IsNullOrWhiteSpace(transcriptText))
        {
            throw new ArgumentException("transcriptText is required.", nameof(transcriptText));
        }

        return new TranscriptHistory(
            id: id == Guid.Empty ? Guid.NewGuid() : id,
            audioContentHash: audioContentHash.Trim(),
            transcriptProvider: transcriptProvider.Trim(),
            transcriptModelVersion: transcriptModelVersion.Trim(),
            transcriptMode: transcriptMode.Trim(),
            transcriptText: transcriptText,
            promptVersion: string.IsNullOrWhiteSpace(promptVersion) ? null : promptVersion.Trim(),
            extractorCodeSha: string.IsNullOrWhiteSpace(extractorCodeSha) ? null : extractorCodeSha.Trim(),
            producedAtUtc: producedAtUtc);
    }
}
