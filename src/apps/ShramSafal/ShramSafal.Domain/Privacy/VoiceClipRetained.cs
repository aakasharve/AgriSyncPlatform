// spec: voice-diary-e2e-2026-05-17 (B.5)
//
// Wave 1.B — Voice Diary domain entity. One row per voice clip the
// user has chosen to retain beyond the 30-day local journal (gated by
// UserConsentState.FullHistoryJournal). Mapped to
// ssf.voice_clips_retained by VoiceClipRetainedConfiguration.
//
// Architecture:
//   - Domain only. No EF imports here — persistence shape lives on
//     ssf.voice_clips_retained via Infrastructure config.
//   - Sealed + private setters. Factory enforces invariants.
//   - Client-supplied clipId is the PK (supervisor risk #1): the
//     Dexie voiceClips.id from the frontend is reused so the unified
//     view in features/voiceDiary can de-dup local+cloud clips
//     cleanly. The factory rejects Guid.Empty.
//   - No collection of attempts / events — this entity is a flat
//     metadata projection over the encrypted blob in S3. The
//     ciphertext lives in IRetainedBlobStore; the row here carries
//     the envelope metadata + the S3 pointer + accounting fields.

namespace ShramSafal.Domain.Privacy;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 07 prerequisite (lands inside the Voice
/// Diary end-to-end ship per voice-diary-e2e-2026-05-17 §B.5) — single
/// retained-tier voice clip belonging to one user. The retention is
/// gated at write time by <see cref="UserConsentState.FullHistoryJournal"/>
/// (enforced by <c>IConsentEnforcer</c> in <c>ParseVoiceInputHandler</c>);
/// once persisted, the row + S3 object survive until the user revokes
/// consent + the ErasureWorker drops them (DPDP §12).
///
/// <para>
/// <b>Envelope encryption.</b> The audio payload is AES-GCM-sealed by
/// the frontend (<c>voiceEnvelope.seal()</c>, Phase 05 doctrine) using
/// the tenant DEK; this row carries the per-clip <see cref="IvBase64"/>
/// + <see cref="AuthTagBase64"/> + <see cref="DekId"/> so the browser
/// can call <c>voiceEnvelope.open()</c> on retrieval. The SERVER NEVER
/// DECRYPTS — that is the Phase 05.6 invariant.
/// </para>
///
/// <para>
/// <b>RLS posture.</b> Like <see cref="UserConsentState"/>, this row is
/// user-keyed not farm-keyed; defence in this ship is at the
/// Application layer (caller passes <c>callerUserId</c> on every read
/// path on <see cref="IRetainedBlobStore"/>). Phase 07 layers RLS on
/// <c>ssf.voice_clips_retained</c>.
/// </para>
/// </summary>
public sealed class VoiceClipRetained
{
    /// <summary>
    /// Primary key. CLIENT-SUPPLIED — the Dexie <c>voiceClips.id</c>
    /// the frontend already minted. Reusing this id is what makes the
    /// unified-view de-dup in features/voiceDiary work without any
    /// server-issued correlation table. Rejected if
    /// <see cref="Guid.Empty"/>.
    /// </summary>
    public Guid ClipId { get; private set; }

    /// <summary>The user this clip belongs to. Rejected if empty.</summary>
    public Guid UserId { get; private set; }

    /// <summary>
    /// When the recording was captured on the device (NOT when it was
    /// uploaded — the local sweep can fire days after recording on a
    /// low-connectivity device). UTC.
    /// </summary>
    public DateTime RecordedAtUtc { get; private set; }

    /// <summary>
    /// Object key inside the retained-tier bucket. Shape:
    /// <c>retained/{userId}/{clipId}.bin</c>. The bucket name is
    /// runtime config (RetainedBlobStoreOptions); the key is
    /// deterministic so re-uploads + deletions are idempotent.
    /// </summary>
    public string S3Key { get; private set; } = string.Empty;

    /// <summary>
    /// Identifier of the tenant DEK that sealed the payload. Indirect
    /// pointer — actual key bytes are held by KMS / the per-tenant DEK
    /// service. Required, non-empty.
    /// </summary>
    public string DekId { get; private set; } = string.Empty;

    /// <summary>
    /// AES-GCM initialisation vector for this clip (base64). Required,
    /// non-empty.
    /// </summary>
    public string IvBase64 { get; private set; } = string.Empty;

    /// <summary>
    /// AES-GCM authentication tag for this clip (base64). Required,
    /// non-empty.
    /// </summary>
    public string AuthTagBase64 { get; private set; } = string.Empty;

    /// <summary>
    /// Duration of the recording in whole seconds. Must be >= 1; clips
    /// shorter than a second are discarded client-side before reaching
    /// this aggregate.
    /// </summary>
    public int DurationSeconds { get; private set; }

    /// <summary>
    /// IETF BCP 47 language tag for the recording (e.g.
    /// <c>"mr-IN"</c>). Required, non-empty.
    /// </summary>
    public string Language { get; private set; } = string.Empty;

    /// <summary>
    /// FK into <c>ssf.consent_audit</c> capturing the audit row that
    /// granted the FullHistoryJournal consent at persist time. Null
    /// when no audit row is available (the enforcer's deny path
    /// never reaches this aggregate so the null case is reserved for
    /// retro-fills / future migrations).
    /// </summary>
    public Guid? ConsentAuditId { get; private set; }

    /// <summary>
    /// Row insertion time (UTC). Distinct from
    /// <see cref="RecordedAtUtc"/>; differs by however long the device
    /// spent offline before uploading.
    /// </summary>
    public DateTime CreatedAtUtc { get; private set; }

    private VoiceClipRetained()
    {
        // EF Core materialisation; do not call.
    }

    /// <summary>
    /// Factory. Enforces the supervisor-mandated invariants:
    /// <list type="bullet">
    /// <item>ClipId comes from the client (Dexie voiceClips.id) and
    /// MUST be non-empty.</item>
    /// <item>UserId MUST be non-empty.</item>
    /// <item>RecordedAtUtc MUST be UTC kind.</item>
    /// <item>Every envelope field (DekId, IvBase64, AuthTagBase64) MUST
    /// be non-empty — without them the ciphertext cannot be opened.</item>
    /// <item>DurationSeconds MUST be >= 1.</item>
    /// <item>Language MUST be non-empty.</item>
    /// </list>
    /// </summary>
    public static VoiceClipRetained Create(
        Guid clipId,
        Guid userId,
        DateTime recordedAtUtc,
        string s3Key,
        string dekId,
        string ivBase64,
        string authTagBase64,
        int durationSeconds,
        string language,
        Guid? consentAuditId,
        DateTime nowUtc)
    {
        if (clipId == Guid.Empty)
        {
            throw new ArgumentException("clipId required (client-supplied PK)", nameof(clipId));
        }
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("userId required", nameof(userId));
        }
        if (recordedAtUtc.Kind != DateTimeKind.Utc)
        {
            throw new ArgumentException("recordedAtUtc must be UTC", nameof(recordedAtUtc));
        }
        if (string.IsNullOrWhiteSpace(s3Key))
        {
            throw new ArgumentException("s3Key required", nameof(s3Key));
        }
        if (string.IsNullOrWhiteSpace(dekId))
        {
            throw new ArgumentException("dekId required", nameof(dekId));
        }
        if (string.IsNullOrWhiteSpace(ivBase64))
        {
            throw new ArgumentException("ivBase64 required", nameof(ivBase64));
        }
        if (string.IsNullOrWhiteSpace(authTagBase64))
        {
            throw new ArgumentException("authTagBase64 required", nameof(authTagBase64));
        }
        if (durationSeconds < 1)
        {
            throw new ArgumentOutOfRangeException(
                nameof(durationSeconds), durationSeconds,
                "durationSeconds must be >= 1");
        }
        if (string.IsNullOrWhiteSpace(language))
        {
            throw new ArgumentException("language required", nameof(language));
        }
        if (consentAuditId is { } cid && cid == Guid.Empty)
        {
            throw new ArgumentException("consentAuditId must be non-empty when supplied", nameof(consentAuditId));
        }

        return new VoiceClipRetained
        {
            ClipId = clipId,
            UserId = userId,
            RecordedAtUtc = recordedAtUtc,
            S3Key = s3Key.Trim(),
            DekId = dekId.Trim(),
            IvBase64 = ivBase64.Trim(),
            AuthTagBase64 = authTagBase64.Trim(),
            DurationSeconds = durationSeconds,
            Language = language.Trim(),
            ConsentAuditId = consentAuditId,
            CreatedAtUtc = nowUtc,
        };
    }

    /// <summary>
    /// Deterministic S3 key shape used by both the persist path and
    /// the deletion sweep. Co-located here so the Domain owns the
    /// content-address rule (Infrastructure adapters re-use this
    /// helper to avoid drift).
    /// </summary>
    public static string BuildS3Key(Guid userId, Guid clipId) =>
        $"retained/{userId:D}/{clipId:D}.bin";
}
