namespace ShramSafal.Domain.AI;

public sealed class AiJobAttempt
{
    private AiJobAttempt() { } // EF Core

    private AiJobAttempt(
        Guid id,
        Guid aiJobId,
        int attemptNumber,
        AiProviderType provider,
        string? requestPayloadHash,
        DateTime attemptedAtUtc)
    {
        Id = id;
        AiJobId = aiJobId;
        AttemptNumber = attemptNumber;
        Provider = provider;
        RequestPayloadHash = NormalizeRequestPayloadHash(requestPayloadHash);
        AttemptedAtUtc = attemptedAtUtc;
        FailureClass = AiFailureClass.None;
    }

    public Guid Id { get; private set; }
    public Guid AiJobId { get; private set; }
    public int AttemptNumber { get; private set; }
    public AiProviderType Provider { get; private set; }
    public bool IsSuccess { get; private set; }
    public AiFailureClass FailureClass { get; private set; }
    public string? ErrorMessage { get; private set; }
    public string? RawProviderResponse { get; private set; }
    public int LatencyMs { get; private set; }
    public int? TokensUsed { get; private set; }
    public decimal? ConfidenceScore { get; private set; }
    public decimal? EstimatedCostUnits { get; private set; }
    public string? RequestPayloadHash { get; private set; }
    public DateTime AttemptedAtUtc { get; private set; }

    public static AiJobAttempt Create(
        Guid id,
        Guid aiJobId,
        int attemptNumber,
        AiProviderType provider,
        string? requestPayloadHash = null)
    {
        if (aiJobId == Guid.Empty)
        {
            throw new ArgumentException("AI job id is required.", nameof(aiJobId));
        }

        if (attemptNumber <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt number must be >= 1.");
        }

        return new AiJobAttempt(id, aiJobId, attemptNumber, provider, requestPayloadHash, DateTime.UtcNow);
    }

    public void RecordSuccess(string rawResponse, int latencyMs, int? tokens, decimal? confidence)
    {
        IsSuccess = true;
        FailureClass = AiFailureClass.None;
        ErrorMessage = null;
        RawProviderResponse = rawResponse;
        LatencyMs = Math.Max(0, latencyMs);
        TokensUsed = tokens;
        ConfidenceScore = confidence.HasValue
            ? Math.Clamp(confidence.Value, 0m, 1m)
            : null;
    }

    public void RecordFailure(AiFailureClass failureClass, string errorMessage, string? rawResponse, int latencyMs)
    {
        IsSuccess = false;
        FailureClass = failureClass == AiFailureClass.None ? AiFailureClass.TransientFailure : failureClass;
        ErrorMessage = string.IsNullOrWhiteSpace(errorMessage) ? "Unknown provider error." : errorMessage.Trim();
        RawProviderResponse = rawResponse;
        LatencyMs = Math.Max(0, latencyMs);
        TokensUsed = null;
        ConfidenceScore = null;
    }

    public void SetEstimatedCostUnits(decimal? estimatedCostUnits)
    {
        if (estimatedCostUnits is null)
        {
            EstimatedCostUnits = null;
            return;
        }

        EstimatedCostUnits = estimatedCostUnits < 0 ? 0 : estimatedCostUnits;
    }

    public void SetRequestPayloadHash(string? requestPayloadHash)
    {
        RequestPayloadHash = NormalizeRequestPayloadHash(requestPayloadHash);
    }

    private static string? NormalizeRequestPayloadHash(string? requestPayloadHash)
    {
        if (string.IsNullOrWhiteSpace(requestPayloadHash))
        {
            return null;
        }

        var normalized = requestPayloadHash.Trim();
        return normalized.Length > 128 ? normalized[..128] : normalized;
    }
}
