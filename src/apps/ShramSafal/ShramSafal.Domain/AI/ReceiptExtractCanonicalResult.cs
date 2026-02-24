namespace ShramSafal.Domain.AI;

public sealed record ReceiptExtractCanonicalResult
{
    public bool Success { get; init; }
    public string? NormalizedJson { get; init; }
    public decimal OverallConfidence { get; init; }
    public string? RawText { get; init; }
    public List<string> Warnings { get; init; } = [];
    public string? Error { get; init; }
}
