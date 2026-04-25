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
    string ValidationOutcome);
