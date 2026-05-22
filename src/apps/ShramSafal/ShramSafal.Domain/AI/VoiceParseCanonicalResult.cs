namespace ShramSafal.Domain.AI;

public sealed record VoiceParseCanonicalResult
{
    public bool Success { get; init; }
    public string? ModelUsed { get; init; }
    public string? PromptVersion { get; init; }

    /// <summary>
    /// Full 64-char SHA-256 of the assembled voice-parsing prompt. Populated
    /// by the orchestrator from <see cref="ShramSafal.Application.Ports.External.IAiPromptBuilder.CurrentVoicePromptContentHash"/>
    /// on both the success and cached-result paths. Threaded onto downstream
    /// <c>Provenance</c> stamps per DATA_PRINCIPLE_SPINE sub-phase 01.4.
    /// </summary>
    public string? PromptContentHash { get; init; }

    public string? NormalizedJson { get; init; }

    /// <summary>
    /// Deprecated transcript holder. Provider adapters still populate this
    /// during the transition, but new callers should read one of
    /// <see cref="TranscriptCodemix"/> or <see cref="TranscriptVerbatim"/>
    /// (and friends) depending on the active voice mode.
    ///
    /// Removal is gated on SARVAM_PRIMARY_VOICE_PIPELINE Phase 2 once
    /// SarvamAiProvider + GeminiAiProvider both stop writing this field.
    /// </summary>
    [Obsolete("Use TranscriptCodemix or TranscriptVerbatim depending on mode.")]
    public string? RawTranscript { get; init; }

    public decimal OverallConfidence { get; init; }
    public List<string> Warnings { get; init; } = [];
    public string? Error { get; init; }

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.8 ────────────────
    // Extended transcript surface. Each provider populates the subset it can
    // emit; nullables are the contract for "this provider does not produce
    // this variant". Threaded through the orchestrator into the AiJob's
    // transcript columns (Task 1.1) and onto TranscriptHistory rows for
    // replay-grade audit.

    /// <summary>
    /// Code-mixed transcript (Marathi + English as spoken, no transliteration).
    /// Primary surface for downstream extraction prompts because it preserves
    /// the speaker's actual lexicon.
    /// </summary>
    public string? TranscriptCodemix { get; init; }

    /// <summary>English-only translation of the utterance.</summary>
    public string? TranscriptEnglish { get; init; }

    /// <summary>
    /// English translation with PII redacted (phone numbers, names of people
    /// other than the speaker, etc). Used when the transcript is exported
    /// to systems outside the speaker's data perimeter.
    /// </summary>
    public string? TranscriptEnglishRedacted { get; init; }

    /// <summary>
    /// Verbatim Marathi transcript in Devanagari script. May contain filler
    /// words, false starts, repetitions — the unedited speech-to-text output.
    /// </summary>
    public string? TranscriptVerbatim { get; init; }

    /// <summary>
    /// Marathi transcript transliterated to Latin script (Roman Marathi).
    /// Surfaces when the consumer cannot render Devanagari.
    /// </summary>
    public string? TranscriptTranslit { get; init; }

    /// <summary>
    /// Alias for <see cref="TranscriptEnglish"/> when the provider distinguishes
    /// "translate" (literal) from "english" (paraphrased). Most providers
    /// collapse the two; this field exists so the schema can stay honest when
    /// they don't.
    /// </summary>
    public string? TranscriptTranslate { get; init; }

    /// <summary>Provider identifier: <c>"Sarvam"</c> or <c>"Gemini"</c>.</summary>
    public string? TranscriptProvider { get; init; }

    /// <summary>
    /// Wire-level model version the provider returned (e.g. <c>"saaras:v3"</c>,
    /// <c>"gemini-2.0-flash"</c>). Stamped onto the AiJob's
    /// <c>transcript_model_version</c> column for A/B replay.
    /// </summary>
    public string? TranscriptModelVersion { get; init; }

    /// <summary>UTC instant the transcript was produced. <c>null</c> if unknown.</summary>
    public DateTime? TranscribedAtUtc { get; init; }

    /// <summary>
    /// Farm-day the utterance is about (which may differ from when it was
    /// recorded — e.g. "yesterday I sprayed"). Paired with
    /// <see cref="ReferencedDateConfidence"/> and <see cref="ReferencedDateReason"/>.
    /// </summary>
    public DateOnly? ReferencedDate { get; init; }

    /// <summary>
    /// Provider's confidence in the inferred <see cref="ReferencedDate"/>,
    /// clamped to [0,1] by the consumer if outside that range.
    /// </summary>
    public decimal? ReferencedDateConfidence { get; init; }

    /// <summary>
    /// Human-readable explanation of how <see cref="ReferencedDate"/> was
    /// inferred (e.g. <c>"phrase 'yesterday' relative to 2026-05-21"</c>).
    /// </summary>
    public string? ReferencedDateReason { get; init; }

    /// <summary>
    /// Raw diarized transcript payload (speaker turns, word-level timings)
    /// as a JSON string. Persisted to <c>diarized_transcript_json</c> on the
    /// AiJob for replay; <c>null</c> when diarization was not produced.
    /// </summary>
    public string? DiarizedTranscriptJson { get; init; }
}
