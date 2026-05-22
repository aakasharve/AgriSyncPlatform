namespace ShramSafal.Domain.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.3 (data-eng brief Theme B-2,
/// Safeguard B2) — append-only candidate row for the golden-set feedback loop.
///
/// <para>
/// Captured by <see cref="Infrastructure.AI.GoldenSetFeedbackWorker"/> every
/// time a farmer corrects an AI-suggested AgriLog field. The worker pairs
/// (audio_content_hash, user_id, farm_id, bucket_id, correction_type,
/// ai_suggested_json, farmer_corrected_json, transcript_codemix,
/// transcript_verbatim, prompt_version, extractor_code_sha) into a single
/// row keyed on the audio-content-hash + correction-type pair — re-runs of
/// the worker over the same correction are idempotent via the unique index.
/// </para>
///
/// <para>
/// <b>PII redactions are OUT.</b> Phase 10.6 OQ-9 carve-out: rows tagged
/// <c>correction_type = 'pii_redaction'</c> are excluded at the worker
/// surface so the candidate set carries only bucket-level signal. This
/// invariant is enforced by the worker filter, not by a check constraint —
/// the column is free-form so future correction taxonomies (e.g.
/// <c>'date-correction'</c>) can extend without a migration.
/// </para>
///
/// <para>
/// <b>Promotion lifecycle.</b> Rows ship with <see cref="PromotedToGoldenSet"/>
/// false and <see cref="PromotedAtUtc"/> null. A future weekly batch (parking
/// lot — golden-set repo authoring infra deferred per envelope) calls
/// <see cref="Promote"/> to flip the bit + stamp the timestamp. Until that
/// infra exists the candidates accrue dormantly — the worker captures
/// without promoting.
/// </para>
///
/// <para>
/// <b>Erasure cascade.</b> The DPDP §12 erasure worker drops every row
/// whose <see cref="UserId"/> matches the target user. See
/// <see cref="Infrastructure.Privacy.ErasureWorker"/>'s extended manifest.
/// </para>
/// </summary>
public sealed class GoldenSetCandidate
{
    private GoldenSetCandidate() { } // EF Core

    private GoldenSetCandidate(
        Guid id,
        string audioContentHash,
        Guid userId,
        Guid farmId,
        string bucketId,
        string correctionType,
        string aiSuggestedJson,
        string farmerCorrectedJson,
        string? transcriptCodemix,
        string? transcriptVerbatim,
        string? promptVersion,
        string? extractorCodeSha,
        DateTime createdAtUtc)
    {
        Id = id;
        AudioContentHash = audioContentHash;
        UserId = userId;
        FarmId = farmId;
        BucketId = bucketId;
        CorrectionType = correctionType;
        AiSuggestedJson = aiSuggestedJson;
        FarmerCorrectedJson = farmerCorrectedJson;
        TranscriptCodemix = transcriptCodemix;
        TranscriptVerbatim = transcriptVerbatim;
        PromptVersion = promptVersion;
        ExtractorCodeSha = extractorCodeSha;
        PromotedToGoldenSet = false;
        CreatedAtUtc = createdAtUtc;
        PromotedAtUtc = null;
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// SHA-256 of the raw audio bytes (64 hex characters). Shared key
    /// with <see cref="TranscriptHistory.AudioContentHash"/> and
    /// <see cref="AiJob.InputContentHash"/>. Part of the dedupe key.
    /// </summary>
    public string AudioContentHash { get; private set; } = string.Empty;

    public Guid UserId { get; private set; }

    public Guid FarmId { get; private set; }

    /// <summary>
    /// One of the 8 voice buckets per ADR-DS-016:
    /// <c>workDone | irrigation | inputs | labour | machinery | expenses
    /// | tasks | observations</c>. Free-form string so new buckets
    /// register without a migration.
    /// </summary>
    public string BucketId { get; private set; } = string.Empty;

    /// <summary>
    /// Correction taxonomy. Today's vocabulary:
    /// <c>value-correction | structural-correction | bucket-correction</c>.
    /// <c>pii_redaction</c> is filtered upstream per Phase 10.6 OQ-9 and
    /// never appears in this column. Free-form for forward-compat.
    /// </summary>
    public string CorrectionType { get; private set; } = string.Empty;

    /// <summary>
    /// Raw AgriLog JSON the AI emitted before the farmer's edit. Stored
    /// verbatim as a string so jsonb-shape changes do not break replay.
    /// </summary>
    public string AiSuggestedJson { get; private set; } = string.Empty;

    /// <summary>
    /// Raw AgriLog JSON after the farmer's corrections. Same storage
    /// posture as <see cref="AiSuggestedJson"/>.
    /// </summary>
    public string FarmerCorrectedJson { get; private set; } = string.Empty;

    /// <summary>
    /// Snapshot of the codemix transcript at correction time. Nullable —
    /// not every correction carries an audio source (e.g. manual edits
    /// on a previously-imported log).
    /// </summary>
    public string? TranscriptCodemix { get; private set; }

    /// <summary>
    /// Snapshot of the verbatim transcript at correction time, if the
    /// verbatim sampler had produced one. Nullable — verbatim is opt-in
    /// per ADR-DS-014, so most rows leave this empty.
    /// </summary>
    public string? TranscriptVerbatim { get; private set; }

    public string? PromptVersion { get; private set; }

    public string? ExtractorCodeSha { get; private set; }

    /// <summary>
    /// Flips true once the weekly promote-batch admits the candidate
    /// into the active golden set. Until the promote infra ships
    /// (parking lot), this stays false on every row.
    /// </summary>
    public bool PromotedToGoldenSet { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    public DateTime? PromotedAtUtc { get; private set; }

    /// <summary>
    /// Factory. Validates that the audio-content hash, user-id, farm-id,
    /// bucket id, correction type, and the two JSON payloads are non-empty.
    /// Trims optional fields and stores null for blank inputs.
    /// </summary>
    public static GoldenSetCandidate Create(
        Guid id,
        string audioContentHash,
        Guid userId,
        Guid farmId,
        string bucketId,
        string correctionType,
        string aiSuggestedJson,
        string farmerCorrectedJson,
        string? transcriptCodemix,
        string? transcriptVerbatim,
        string? promptVersion,
        string? extractorCodeSha,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(audioContentHash))
        {
            throw new ArgumentException("audioContentHash is required.", nameof(audioContentHash));
        }

        if (userId == Guid.Empty)
        {
            throw new ArgumentException("userId is required.", nameof(userId));
        }

        if (farmId == Guid.Empty)
        {
            throw new ArgumentException("farmId is required.", nameof(farmId));
        }

        if (string.IsNullOrWhiteSpace(bucketId))
        {
            throw new ArgumentException("bucketId is required.", nameof(bucketId));
        }

        if (string.IsNullOrWhiteSpace(correctionType))
        {
            throw new ArgumentException("correctionType is required.", nameof(correctionType));
        }

        if (string.IsNullOrWhiteSpace(aiSuggestedJson))
        {
            throw new ArgumentException("aiSuggestedJson is required.", nameof(aiSuggestedJson));
        }

        if (string.IsNullOrWhiteSpace(farmerCorrectedJson))
        {
            throw new ArgumentException("farmerCorrectedJson is required.", nameof(farmerCorrectedJson));
        }

        return new GoldenSetCandidate(
            id: id == Guid.Empty ? Guid.NewGuid() : id,
            audioContentHash: audioContentHash.Trim(),
            userId: userId,
            farmId: farmId,
            bucketId: bucketId.Trim(),
            correctionType: correctionType.Trim(),
            aiSuggestedJson: aiSuggestedJson,
            farmerCorrectedJson: farmerCorrectedJson,
            transcriptCodemix: string.IsNullOrWhiteSpace(transcriptCodemix) ? null : transcriptCodemix,
            transcriptVerbatim: string.IsNullOrWhiteSpace(transcriptVerbatim) ? null : transcriptVerbatim,
            promptVersion: string.IsNullOrWhiteSpace(promptVersion) ? null : promptVersion.Trim(),
            extractorCodeSha: string.IsNullOrWhiteSpace(extractorCodeSha) ? null : extractorCodeSha.Trim(),
            createdAtUtc: createdAtUtc);
    }

    /// <summary>
    /// Flip <see cref="PromotedToGoldenSet"/> true and stamp
    /// <see cref="PromotedAtUtc"/>. Invoked by the weekly batch
    /// promote-job once it ships (parking lot — golden-set repo
    /// authoring infra deferred per envelope).
    /// </summary>
    public void Promote(DateTime promotedAtUtc)
    {
        if (PromotedToGoldenSet)
        {
            // Idempotent: re-promoting a row is a no-op rather than an
            // exception. Lets the batch promote-job re-run safely
            // without filter discipline on its query.
            return;
        }

        PromotedToGoldenSet = true;
        PromotedAtUtc = promotedAtUtc;
    }
}
