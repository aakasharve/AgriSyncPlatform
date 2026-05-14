using System.Text.Json;

namespace ShramSafal.Domain.AI;

public sealed record FieldConfidence(
    decimal Score,
    ConfidenceScore Level,
    string? Reason = null,
    string? BucketId = null)
{
    public static FieldConfidence Create(decimal score, string? reason = null, string? bucketId = null)
    {
        var normalized = ConfidenceScorePolicy.Normalize(score);
        return new FieldConfidence(normalized, ConfidenceScorePolicy.FromScore(normalized), reason, bucketId);
    }
}

public sealed record VoiceParseResult(
    JsonElement ParsedLog,
    decimal Confidence,
    IReadOnlyDictionary<string, FieldConfidence> FieldConfidences,
    string SuggestedAction,
    string ModelUsed,
    string? PromptVersion,
    string ProviderUsed,
    bool FallbackUsed,
    int LatencyMs,
    string ValidationOutcome,
    // Full 64-char SHA-256 of the assembled voice-parsing prompt content.
    // Stamped on the resulting Provenance per DATA_PRINCIPLE_SPINE
    // Phase 01 sub-phase 01.2. Nullable for the legacy non-modular path
    // and pre-spine callers; sub-phase 01.4 wires the orchestrator.
    string? PromptContentHash = null);
