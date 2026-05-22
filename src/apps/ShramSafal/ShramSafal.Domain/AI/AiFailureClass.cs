namespace ShramSafal.Domain.AI;

public enum AiFailureClass
{
    None = 0,
    TransientFailure = 1,
    ProviderRateLimit = 2,
    ParseFailure = 3,
    SchemaInvalid = 4,
    LowConfidence = 5,
    UnsupportedInput = 6,
    UserError = 7,

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.5 ────────────
    // Sarvam-specific failure classes. Numeric values are reserved
    // (do NOT renumber the legacy classes above) so EF Core's stored
    // int encoding stays stable across the cohort rollout.
    //
    // Fallback semantics (encoded by AiFailureClassifier.IsFallbackEligible):
    //   SarvamConnectionLost       → fallback eligible (single-call multimodal)
    //   SarvamFirstTokenTimeout    → fallback eligible
    //   SarvamEmptyTranscript      → fallback eligible
    //   SarvamRateLimit            → NOT fallback eligible (exponential retry)
    //   SarvamRegionalOutage       → fallback eligible

    /// <summary>WebSocket connection dropped mid-stream.</summary>
    SarvamConnectionLost = 8,

    /// <summary>First transcript chunk didn't arrive within the configured budget (default 8s).</summary>
    SarvamFirstTokenTimeout = 9,

    /// <summary>Sarvam returned empty or whitespace-only text.</summary>
    SarvamEmptyTranscript = 10,

    /// <summary>Sarvam HTTP 429 — retry with exponential backoff, do NOT fall back.</summary>
    SarvamRateLimit = 11,

    /// <summary>Sarvam HTTP 5xx or DNS failure — regional outage, fall back to legacy multimodal.</summary>
    SarvamRegionalOutage = 12,
}
