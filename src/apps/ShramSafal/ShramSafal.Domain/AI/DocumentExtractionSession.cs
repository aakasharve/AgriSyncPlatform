namespace ShramSafal.Domain.AI;

public sealed class DocumentExtractionSession
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid FarmId { get; private set; }
    public DocumentType DocumentType { get; private set; }
    public ExtractionSessionStatus Status { get; private set; }
    public string? DraftResultJson { get; private set; }
    public string? VerifiedResultJson { get; private set; }
    public decimal DraftConfidence { get; private set; }
    public decimal? VerifiedConfidence { get; private set; }
    public string? DraftProvider { get; private set; }
    public string? VerificationProvider { get; private set; }
    public Guid? DraftAiJobId { get; private set; }
    public Guid? VerificationAiJobId { get; private set; }
    public string? InputImagePath { get; private set; }
    public string? InputMimeType { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    public static DocumentExtractionSession Create(
        Guid userId, Guid farmId, DocumentType documentType)
    {
        return new DocumentExtractionSession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            FarmId = farmId,
            DocumentType = documentType,
            Status = ExtractionSessionStatus.Captured,
            CreatedAtUtc = DateTime.UtcNow,
            ModifiedAtUtc = DateTime.UtcNow
        };
    }

    public void SetInput(string imagePath, string mimeType)
    {
        InputImagePath = imagePath;
        InputMimeType = mimeType;
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void SetDraftResult(string resultJson, decimal confidence, string provider, Guid aiJobId)
    {
        DraftResultJson = resultJson;
        DraftConfidence = confidence;
        DraftProvider = provider;
        DraftAiJobId = aiJobId;
        Status = ExtractionSessionStatus.DraftReady;
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void StartVerification()
    {
        Status = ExtractionSessionStatus.Verifying;
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void SetVerifiedResult(string resultJson, decimal confidence, string provider, Guid aiJobId)
    {
        VerifiedResultJson = resultJson;
        VerifiedConfidence = confidence;
        VerificationProvider = provider;
        VerificationAiJobId = aiJobId;
        Status = ExtractionSessionStatus.Verified;
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void MarkNeedsReview(string reason)
    {
        Status = ExtractionSessionStatus.NeedsReview;
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void Complete()
    {
        Status = ExtractionSessionStatus.Completed;
        ModifiedAtUtc = DateTime.UtcNow;
    }
}

public enum DocumentType
{
    Receipt,
    Patti
}

public enum ExtractionSessionStatus
{
    Captured,
    DraftReady,
    Verifying,
    Verified,
    NeedsReview,
    Completed
}
