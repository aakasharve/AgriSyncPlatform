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

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.1 ────────────────
    // Additive columns for the voice spine: six transcript variants, the
    // provider/model that produced them, when they were produced, the
    // schema-version of the transcript record, the extractor code SHA, a
    // structured (date, confidence, reason) triple for the referenced
    // farm-day, and the raw diarized transcript payload. All nullable for
    // backfill safety except TranscriptSchemaVersion which defaults to
    // "v1.0" so legacy rows have a deterministic value.
    public string? TranscriptCodemix { get; private set; }
    public string? TranscriptEnglish { get; private set; }
    public string? TranscriptEnglishRedacted { get; private set; }
    public string? TranscriptVerbatim { get; private set; }
    public string? TranscriptTranslit { get; private set; }
    public string? TranscriptTranslate { get; private set; }
    public string? TranscriptProvider { get; private set; }
    public string? TranscriptModelVersion { get; private set; }
    public DateTime? TranscribedAtUtc { get; private set; }
    public string TranscriptSchemaVersion { get; private set; } = "v1.0";
    public string? ExtractorCodeSha { get; private set; }
    public DateOnly? ReferencedDate { get; private set; }
    public decimal? ReferencedDateConfidence { get; private set; }
    public string? ReferencedDateReason { get; private set; }
    public string? DiarizedTranscriptJson { get; private set; }

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

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.1 ────────────────
    // Domain encapsulation for the six transcript variants emitted by the
    // voice pipeline. All variant strings are optional (provider may emit
    // a subset); transcriptProvider + transcriptModelVersion are required
    // because every transcript carries its lineage. transcriptSchemaVersion
    // is opt-in — null means "leave the existing value alone" so callers
    // can update transcript content without rolling the schema-version
    // pointer. TranscribedAtUtc is stamped here (DateTime.UtcNow) as the
    // single authoritative "we just wrote a transcript" timestamp.
    public void SetTranscriptResults(
        string? codemix,
        string? english,
        string? englishRedacted,
        string? verbatim,
        string? translit,
        string? translate,
        string transcriptProvider,
        string transcriptModelVersion,
        string? transcriptSchemaVersion = null)
    {
        if (string.IsNullOrWhiteSpace(transcriptProvider))
        {
            throw new ArgumentException("transcriptProvider is required", nameof(transcriptProvider));
        }

        if (string.IsNullOrWhiteSpace(transcriptModelVersion))
        {
            throw new ArgumentException("transcriptModelVersion is required", nameof(transcriptModelVersion));
        }

        TranscriptCodemix = string.IsNullOrWhiteSpace(codemix) ? null : codemix.Trim();
        TranscriptEnglish = string.IsNullOrWhiteSpace(english) ? null : english.Trim();
        TranscriptEnglishRedacted = string.IsNullOrWhiteSpace(englishRedacted) ? null : englishRedacted.Trim();
        TranscriptVerbatim = string.IsNullOrWhiteSpace(verbatim) ? null : verbatim.Trim();
        TranscriptTranslit = string.IsNullOrWhiteSpace(translit) ? null : translit.Trim();
        TranscriptTranslate = string.IsNullOrWhiteSpace(translate) ? null : translate.Trim();

        TranscriptProvider = transcriptProvider.Trim();
        TranscriptModelVersion = transcriptModelVersion.Trim();
        TranscribedAtUtc = DateTime.UtcNow;

        if (!string.IsNullOrWhiteSpace(transcriptSchemaVersion))
        {
            TranscriptSchemaVersion = transcriptSchemaVersion.Trim();
        }

        ModifiedAtUtc = DateTime.UtcNow;
    }

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.1 ────────────────
    // ReferencedDate is the farm-day the user is talking about (which may
    // differ from CreatedAtUtc — e.g. "yesterday I sprayed"). Stored as a
    // (date, confidence, reason) triple because every inferred date needs
    // an auditable explanation. Confidence is clamped to [0,1] when
    // supplied so callers that overshoot don't poison the column. Caller
    // may pass all-null to clear an earlier inference.
    public void SetReferencedDate(DateOnly? date, decimal? confidence, string? reason)
    {
        ReferencedDate = date;
        ReferencedDateConfidence = confidence is null
            ? null
            : Math.Clamp(confidence.Value, 0m, 1m);
        ReferencedDateReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        ModifiedAtUtc = DateTime.UtcNow;
    }

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.1 ────────────────
    // The diarized transcript is the raw provider payload (speaker turns,
    // word-level timings). We persist it as a jsonb string for replay/audit;
    // null = no diarization was produced for this job.
    public void SetDiarizedTranscript(string? diarizedJson)
    {
        DiarizedTranscriptJson = string.IsNullOrWhiteSpace(diarizedJson)
            ? null
            : diarizedJson.Trim();
        ModifiedAtUtc = DateTime.UtcNow;
    }

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.1 ────────────────
    // Git SHA of the extractor code that produced NormalizedResultJson.
    // Stored at column width 40 (full SHA); short SHAs are also accepted.
    // Whitespace-only / empty arguments clear the column.
    public void SetExtractorCodeSha(string? sha)
    {
        ExtractorCodeSha = string.IsNullOrWhiteSpace(sha) ? null : sha.Trim();
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
