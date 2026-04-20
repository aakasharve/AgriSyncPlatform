using System.Text.Json;

namespace ShramSafal.Domain.AI;

public sealed record FieldConfidence(
    decimal Score,
    ConfidenceScore Level,
    string? Reason = null)
{
    public static FieldConfidence Create(decimal score, string? reason = null)
    {
        var normalized = ConfidenceScorePolicy.Normalize(score);
        return new FieldConfidence(normalized, ConfidenceScorePolicy.FromScore(normalized), reason);
    }
}

public sealed record VoiceParseResult(
    JsonElement ParsedLog,
    decimal Confidence,
    IReadOnlyDictionary<string, FieldConfidence> FieldConfidences,
    string SuggestedAction,
    string ModelUsed,
    int LatencyMs,
    string ValidationOutcome);
