using ShramSafal.Domain.Common;

namespace ShramSafal.Domain.AI;

public sealed class AiJob
{
    private readonly List<AiJobAttempt> _attempts = [];

    private AiJob() { } // EF Core

    private AiJob(
        Guid id,
        string idempotencyKey,
        AiOperationType operationType,
        Guid userId,
        Guid farmId,
        string? inputContentHash,
        string? rawInputRef,
        string? inputSessionMetadataJson,
        DateTime createdAtUtc,
        Provenance provenance)
    {
        Id = id;
        IdempotencyKey = idempotencyKey;
        OperationType = operationType;
        UserId = userId;
        FarmId = farmId;
        Status = AiJobStatus.Queued;
        InputContentHash = inputContentHash;
        RawInputRef = rawInputRef;
        InputSessionMetadataJson = inputSessionMetadataJson;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
        Provenance = provenance;
    }

    public Guid Id { get; private set; }
    public string IdempotencyKey { get; private set; } = string.Empty;
    public AiOperationType OperationType { get; private set; }
    public Guid UserId { get; private set; }
    public Guid FarmId { get; private set; }
    public AiJobStatus Status { get; private set; }
    public string? InputContentHash { get; private set; }
    public string? RawInputRef { get; private set; }
    public string? InputSessionMetadataJson { get; private set; }
    public Provenance Provenance { get; private set; } = null!;
    public string? NormalizedResultJson { get; private set; }
    public int? InputSpeechDurationMs { get; private set; }
    public int? InputRawDurationMs { get; private set; }
    public string SchemaVersion { get; private set; } = "1.0.0";
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? CompletedAtUtc { get; private set; }
    public int TotalAttempts { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    public IReadOnlyCollection<AiJobAttempt> Attempts => _attempts.AsReadOnly();

    public static AiJob Create(
        Guid id,
        string idempotencyKey,
        AiOperationType operationType,
        Guid userId,
        Guid farmId,
        string? inputContentHash,
        string? rawInputRef,
        string? inputSessionMetadataJson = null,
        Provenance? provenance = null)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Job id is required.", nameof(id));
        }

        if (string.IsNullOrWhiteSpace(idempotencyKey))
        {
            throw new ArgumentException("Idempotency key is required.", nameof(idempotencyKey));
        }

        if (userId == Guid.Empty)
        {
            throw new ArgumentException("User id is required.", nameof(userId));
        }

        if (farmId == Guid.Empty)
        {
            throw new ArgumentException("Farm id is required.", nameof(farmId));
        }

        var effectiveProvenance = provenance ?? Provenance.Manual("unknown");

        return new AiJob(
            id,
            idempotencyKey.Trim(),
            operationType,
            userId,
            farmId,
            string.IsNullOrWhiteSpace(inputContentHash) ? null : inputContentHash.Trim(),
            string.IsNullOrWhiteSpace(rawInputRef) ? null : rawInputRef.Trim(),
            string.IsNullOrWhiteSpace(inputSessionMetadataJson) ? null : inputSessionMetadataJson.Trim(),
            DateTime.UtcNow,
            effectiveProvenance);
    }

    public AiJobAttempt AddAttempt(AiProviderType provider, string? requestPayloadHash = null)
    {
        // Codex cross-verification 2026-05-15 MAJOR-1: attempts must inherit
        // the parent AiJob's Provenance, not silently fall back to
        // Provenance.Manual("unknown"). The post-attempt UpdateProvenance
        // flow (F3) updates the parent's ModelVersion once known; that
        // refresh applies to subsequent attempts but each attempt's
        // recorded provenance must at minimum carry the correct Source.
        var attempt = AiJobAttempt.Create(
            Guid.NewGuid(),
            Id,
            TotalAttempts + 1,
            provider,
            requestPayloadHash,
            Provenance);
        _attempts.Add(attempt);
        TotalAttempts++;
        Status = AiJobStatus.Running;
        ModifiedAtUtc = DateTime.UtcNow;
        return attempt;
    }

    public void MarkSucceeded(string normalizedResultJson, AiJobAttempt successfulAttempt)
    {
        EnsureAttemptBelongsToThisJob(successfulAttempt);

        NormalizedResultJson = normalizedResultJson;
        Status = AiJobStatus.Succeeded;
        CompletedAtUtc = DateTime.UtcNow;
        ModifiedAtUtc = CompletedAtUtc.Value;
    }

    public void UpdateProvenance(string modelVersion)
    {
        if (string.IsNullOrWhiteSpace(modelVersion))
        {
            throw new ArgumentException("modelVersion is required", nameof(modelVersion));
        }

        Provenance = new Provenance(
            source: Provenance.Source,
            modelVersion: modelVersion,
            promptVersion: Provenance.PromptVersion,
            promptContentHash: Provenance.PromptContentHash,
            appVersion: Provenance.AppVersion);

        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void MarkFailed()
    {
        Status = AiJobStatus.Failed;
        CompletedAtUtc = DateTime.UtcNow;
        ModifiedAtUtc = CompletedAtUtc.Value;
    }

    public void MarkFallbackSucceeded(string normalizedResultJson, AiJobAttempt fallbackAttempt)
    {
        EnsureAttemptBelongsToThisJob(fallbackAttempt);

        NormalizedResultJson = normalizedResultJson;
        Status = AiJobStatus.FallbackSucceeded;
        CompletedAtUtc = DateTime.UtcNow;
        ModifiedAtUtc = CompletedAtUtc.Value;
    }

    public void SetInputDurations(int? speechDurationMs, int? rawDurationMs)
    {
        InputSpeechDurationMs = speechDurationMs is null ? null : Math.Max(0, speechDurationMs.Value);
        InputRawDurationMs = rawDurationMs is null ? null : Math.Max(0, rawDurationMs.Value);
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void SetSchemaVersion(string schemaVersion)
    {
        if (string.IsNullOrWhiteSpace(schemaVersion))
        {
            return;
        }

        SchemaVersion = schemaVersion.Trim();
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void SetInputSessionMetadataJson(string? sessionMetadataJson)
    {
        InputSessionMetadataJson = string.IsNullOrWhiteSpace(sessionMetadataJson)
            ? null
            : sessionMetadataJson.Trim();
        ModifiedAtUtc = DateTime.UtcNow;
    }

    private void EnsureAttemptBelongsToThisJob(AiJobAttempt attempt)
    {
        if (attempt.AiJobId != Id)
        {
            throw new InvalidOperationException("Attempt does not belong to this job.");
        }

        if (_attempts.All(existing => existing.Id != attempt.Id))
        {
            _attempts.Add(attempt);
        }
    }
}
