namespace ShramSafal.Domain.AI;

public sealed record VoiceSessionMetadata
{
    public string? SessionId { get; init; }
    public string? FarmId { get; init; }
    public int? TotalSegments { get; init; }
    public int? TotalSpeechDurationMs { get; init; }
    public int? TotalRawDurationMs { get; init; }
    public int? TotalSilenceRemovedMs { get; init; }
    public decimal? CompressionRatio { get; init; }
    public IReadOnlyList<VoiceSegmentMetadata> Segments { get; init; } = [];
    public IReadOnlyList<string> Warnings { get; init; } = [];
}

public sealed record VoiceSegmentMetadata
{
    public int SegmentIndex { get; init; }
    public string? MimeType { get; init; }
    public int? RawDurationMs { get; init; }
    public int? SpeechDurationMs { get; init; }
    public int? SilenceRemovedMs { get; init; }
    public int? ByteSize { get; init; }
    public string? ContentHash { get; init; }
}
