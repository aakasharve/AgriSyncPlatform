namespace ShramSafal.Domain.OCR;

public sealed record OcrExtractionResult
{
    public Guid AttachmentId { get; init; }
    public string RawText { get; init; } = string.Empty;
    public IReadOnlyList<ExtractedField> Fields { get; init; } = [];
    public decimal OverallConfidence { get; init; }
    public string ModelUsed { get; init; } = string.Empty;
    public int LatencyMs { get; init; }
    public DateTime ExtractedAtUtc { get; init; }
}

public sealed record ExtractedField
{
    public string FieldName { get; init; } = string.Empty;
    public string Value { get; init; } = string.Empty;
    public decimal Confidence { get; init; }
}
