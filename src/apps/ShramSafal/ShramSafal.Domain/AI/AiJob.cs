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

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.1 + 1.7 ─────────
    // Additive columns for the voice spine: six transcript variants, the
    // provider/model that produced them, when they were produced, the
    // schema-version of the transcript record, a structured (date,
    // confidence, reason) triple for the referenced farm-day, and the raw
    // diarized transcript payload. All nullable for backfill safety except
    // TranscriptSchemaVersion which defaults to "v1.0" so legacy rows have
    // a deterministic value.
    //
    // Task 1.7: ExtractorCodeSha moved from a top-level AiJob property to
    // the shared Provenance owned record so every Provenance-owning table
    // carries the column uniformly (ADR-DS-014 §E). The Phase 1.1 column
    // on ssf.ai_jobs stays put — it is just remapped to be owned by
    // Provenance instead of AiJob. Read it via Provenance.ExtractorCodeSha.
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
        //
        // 2026-06-09: give the attempt its OWN Provenance instance (a value
        // copy of the parent's), NOT the shared parent reference. EF Core
        // owned types are per-owner: assigning the SAME CLR Provenance instance
        // to both the AiJob and its AiJobAttempt makes EF bind the owned tuple
        // to the first owner (the job) and persist NULL for the attempt's owned
        // columns — which trips the `source` NOT NULL constraint on
        // ssf.ai_job_attempts (Npgsql 23502) the first time a voice-parse job
        // actually completes its write on a real relational provider. The EF
        // InMemory provider used by the AI endpoint tests does not enforce
        // NOT NULL, so this was latent/prod-only. A distinct instance gives the
        // attempt its own owned tuple while preserving identical lineage values.
        var attemptProvenance = new Provenance(
            Provenance.Source,
            Provenance.ModelVersion,
            Provenance.PromptVersion,
            Provenance.PromptContentHash,
            Provenance.AppVersion,
            Provenance.ExtractorCodeSha);
        var attempt = AiJobAttempt.Create(
            Guid.NewGuid(),
            Id,
            TotalAttempts + 1,
            provider,
            requestPayloadHash,
            attemptProvenance);
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
            appVersion: Provenance.AppVersion,
            extractorCodeSha: Provenance.ExtractorCodeSha);

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

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.7 ────────────────
    // Phase 1.1's top-level SetExtractorCodeSha mutator was removed because
    // ExtractorCodeSha now lives on the shared Provenance owned record
    // (ADR-DS-014 §E). Callers that need to stamp the extractor SHA
    // construct a new Provenance and pass it on AiJob.Create, or rely on
    // UpdateProvenance to copy the SHA forward when only ModelVersion
    // changes.
    //
    // TODO(spec-1.7-step4): wire <SourceRevisionId> MSBuild → embedded
    // AssemblyInformationalVersion → static accessor and have the
    // orchestrator pass the SHA via Provenance on AiJob.Create. Until
    // that lands the extractor SHA stays null on most rows (deliberate,
    // not a bug).

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
