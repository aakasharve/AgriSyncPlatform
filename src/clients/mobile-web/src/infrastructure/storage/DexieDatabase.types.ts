// Table record types extracted from DexieDatabase.ts to keep that file under
// the 800-line mobile-web size budget. Pure type move — no behavior change.
// DexieDatabase.ts re-exports everything here so existing
// `import { X } from '.../DexieDatabase'` call sites keep working unchanged.

import type { DailyLog } from '../../types';
import type { AttendanceMarkDto } from '../api/dtos';
import type { JobCard } from '../../domain/work/JobCard';
import type { WorkerProfileData } from '../../domain/work/ReliabilityScore';
import type {
    DexieTestProtocol,
    DexieTestResult,
    DexieTestInstance,
    DexieTestRecommendation,
} from './DexieDatabase.testTypes';

// =============================================================================
// OUTBOX (Pending sync events)
// =============================================================================

export type OutboxAction =
    | 'CREATE_LOG'
    | 'UPDATE_LOG'
    | 'DELETE_LOG'
    | 'CONFIRM_LOG'
    | 'VERIFY_LOG'
    | 'DISPUTE_LOG'
    | 'CORRECT_LOG';

export type OutboxStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';

export interface OutboxEvent {
    /** Auto-incremented by Dexie */
    id?: number;
    /** Idempotency key: `{logId}_{action}_{capturedAtMs}` */
    idempotencyKey: string;
    action: OutboxAction;
    resourceId: string;
    payload: unknown;
    status: OutboxStatus;
    createdAt: string;
    retryCount: number;
    lastAttemptAt?: string;
    error?: string;
}

// =============================================================================
// MUTATION QUEUE (Backend sync-ready queue)
// =============================================================================

/**
 * Sub-plan 04 Task 5 / T-IGH-04-CONFLICT-STATUS-DURABILITY:
 * - PENDING            queued, eligible for next worker cycle.
 * - SENDING            in flight to server.
 * - APPLIED            server accepted (or duplicate).
 * - FAILED             transient failure (network blip, unknown error).
 *                      Eligible for auto-retry via markFailedAsPending.
 * - REJECTED_USER_REVIEW
 *                      DURABLE rejection — server gave an error code that
 *                      RejectionPolicy classifies as "permanent" (CLIENT_TOO_OLD,
 *                      MUTATION_TYPE_UNKNOWN, MUTATION_TYPE_UNIMPLEMENTED, etc.).
 *                      markFailedAsPending must SKIP these; the user must
 *                      explicitly retry or discard via OfflineConflictPage.
 * - REJECTED_DROPPED   user explicitly discarded a REJECTED_USER_REVIEW row.
 *                      Soft-delete — kept for audit + Sub-plan 05 E2E
 *                      assertion. Never returned by getPending(); never
 *                      included in conflict UI list().
 */
export type MutationQueueStatus =
    | 'PENDING'
    | 'SENDING'
    | 'APPLIED'
    | 'FAILED'
    | 'REJECTED_USER_REVIEW'
    | 'REJECTED_DROPPED';

export interface MutationQueueItem {
    id?: number;
    deviceId: string;
    clientRequestId: string;
    clientCommandId: string;
    mutationType: string;
    payload: unknown;
    status: MutationQueueStatus;
    createdAt: string;
    updatedAt: string;
    /**
     * CHARGED attempts. Gates `MAX_AUTO_RETRY_COUNT` and therefore whether the
     * farmer is asked to act. Only a `REJECTION` increments it — a transport
     * fault or a missing parent never judged this row (`RejectionPolicy`).
     */
    retryCount: number;
    lastError?: string;
    /**
     * §P0.7 box 2c — epoch ms before which `getPending` will not offer this row.
     *
     * NOT INDEXED, deliberately: Dexie only needs a schema declaration for
     * fields it indexes, so this needed no version bump — the same property
     * `PendingAiJobRecord.nextRetryAfterMs` already relies on
     * (`pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]'`).
     * A bump is one-way for APK users and must never ride along with a
     * behaviour change.
     *
     * Absolute rather than relative so it survives the app being killed: after
     * a restart hours later the deadline is simply long past, which is the
     * right answer.
     */
    nextRetryAfterMs?: number;
    /**
     * §P0.7 box 2c — EVERY attempt, charged or not. Drives the backoff exponent
     * and nothing else.
     *
     * Distinct from `retryCount` on purpose, and the distinction is the whole
     * point: transport faults and dependency waits must not consume the cap,
     * but they must still slow the row down, or a child whose parent is one
     * batch behind re-asks the server every 15 seconds for free. Reading the
     * exponent off `retryCount` would leave every uncharged failure permanently
     * at the two-second step, i.e. no backoff at all on exactly the paths that
     * need it most.
     */
    attemptCount?: number;
}

// =============================================================================
// ATTACHMENTS (Metadata + local linkage)
// =============================================================================

export type LocalAttachmentStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface AttachmentRecord {
    /** Local attachment id (and server id when provided via attachmentId) */
    id: string;
    farmId: string;
    linkedEntityId?: string;
    linkedEntityType?: string;
    /** Device-local file reference used by upload worker */
    localPath: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
    status: LocalAttachmentStatus;
    remoteAttachmentId?: string;
    uploadedAtUtc?: string;
    finalizedAtUtc?: string;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
    lastError?: string;
}

// =============================================================================
// ATTACHMENT UPLOAD QUEUE
// =============================================================================

export type UploadQueueStatus = 'pending' | 'uploading' | 'retry_wait' | 'failed' | 'completed';

export interface UploadQueueItem {
    autoId?: number;
    attachmentId: string;
    status: UploadQueueStatus;
    retryCount: number;
    lastAttemptAt?: string;
    nextAttemptAt?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
}

// =============================================================================
// PENDING AI JOBS (Offline queue for voice/receipt/patti AI requests)
// =============================================================================

export type PendingAiOperationType = 'voice_parse' | 'receipt_extract' | 'patti_extract';
export type PendingAiJobStatus = 'pending' | 'processing' | 'failed' | 'failed_permanent' | 'completed';

export interface PendingAiAttemptSignature {
    signature: string;
    errorClass: string;
    firstSeenAtMs: number;
    lastSeenAtMs: number;
    count: number;
}

export interface PendingAiJobContext {
    farmId?: string;
    userId?: string;
    operation?: 'voice' | 'receipt' | 'patti' | 'text';
    plotId?: string;
    cropCycleId?: string;
    cropName?: string;
    parseContext?: object;
    textTranscript?: string;
    idempotencyKey?: string;
    requestPayloadHash?: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
    segmentMetadataJson?: string;
    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix (Option B):
    // the ISO-8601 UTC instant when MediaRecorder captured the audio.
    // Persisted on the offline-queue row so that when the background
    // worker drains the queue (possibly hours later after connectivity
    // returns), the original recording instant is what's posted as
    // `recorded_at` — not the queue-drain wall clock.
    recordedAtUtc?: string;
}

export interface PendingAiJobRecord {
    id?: number;
    operationType: PendingAiOperationType;
    inputBlob?: Blob;
    inputMimeType?: string;
    context: PendingAiJobContext;
    status: PendingAiJobStatus;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
    lastError?: string;
    nextRetryAfterMs?: number;
    attemptSignatures?: PendingAiAttemptSignature[];
    /**
     * THE THING THE SERVER SENT BACK. Written when the job completes.
     *
     * Until this field existed, the worker awaited the parse and assigned the
     * answer to nothing — the audio uploaded, the server read it, the job was
     * marked `completed`, and the farmer's spoken note produced NOTHING he
     * could ever see. On a voice-first app that is the product failing, not a
     * feature failing.
     *
     * Stored VERBATIM, exactly as the API returned it. The live path already
     * owns the normalisation (`BackendAiClient` — schema parse, then a drift
     * fallback), and duplicating that here would give the app two readings of
     * one payload that drift apart. The reviewing surface normalises on read,
     * through the same code the live path uses.
     *
     * This is TEMPORARY PROCESSING DATA, not business truth, and it is
     * deliberately NOT turned into a `DailyLog` on arrival: the farmer has not
     * confirmed it. Writing an unconfirmed log would assert he recorded
     * something he never approved. It stays here until he does.
     *
     * NON-INDEXED ON PURPOSE — no Dexie version bump, so no one-way upgrade for
     * APK users. Old rows simply have no `result`, which reads as "this job
     * completed before the app could keep the answer" and is exactly true.
     */
    result?: PendingAiJobResult;
    /**
     * WHETHER THE PERMANENT-ARCHIVE HALF OF THIS JOB ACTUALLY HAPPENED.
     *
     * `status: 'completed'` is about the PARSE, and the parse really did
     * succeed — re-running the job to retry an archive would re-run a paid AI
     * call and re-upload the audio, which is worse than the defect. So the job
     * still completes, and this field stops `completed` from claiming more than
     * it earned: it distinguishes "parsed and archived" from "parsed, archive
     * failed".
     *
     * Before it, the archive call's result was discarded outright and a failed
     * archive was indistinguishable from a successful one anywhere in the
     * system (founder ruling D9).
     *
     * Shape is declared here rather than imported from `infrastructure/voice`
     * so the storage types keep no dependency on that module. NON-INDEXED — no
     * Dexie version bump; absent on old rows, which reads as "this job predates
     * the record" and is exactly true.
     */
    retainedArchive?: PendingAiJobRetainedArchive;
}

/** See `PendingAiJobRecord.retainedArchive`. */
export interface PendingAiJobRetainedArchive {
    status: 'archived' | 'skipped' | 'failed';
    /** Machine reason from `VoiceClipArchiveOutcome`; absent when archived. */
    reason?: string;
    /**
     * POST attempts made — written for `archived` and `failed` only.
     *
     * OMITTED FOR EVERY `skipped` OUTCOME, which after review C1 is every clip
     * in production today: `AiJobWorker` spreads this key conditionally
     * (`'attempts' in outcome`) and a skip carries no attempt count to spread.
     *
     * Third attempt at this sentence, so it now describes WHAT THE WRITER DOES
     * rather than what the field means. It first claimed "absent when the wire
     * was never reached" (false — `0` is written for a reached-nothing failure),
     * then "`0` … never omitted" (false the other way — omitted for skips). A
     * sweep written from either sentence would return zero rows on exactly the
     * population it was written to find.
     */
    attempts?: number;
    /** When the archive step ran. */
    at: string;
}

/**
 * A completed job's answer, kept with enough context to review it later.
 *
 * `receivedAtUtc` is the moment the DEVICE received it, which is not the moment
 * the farmer spoke — a note recorded at dusk and drained next morning has a
 * `recordedAtUtc` on its clip and this stamp a night later. Both are kept
 * because conflating them would misdate the farmer's own day.
 */
export interface PendingAiJobResult {
    operationType: PendingAiOperationType;
    receivedAtUtc: string;
    /** Verbatim API response. Shape varies by `operationType`; normalised on read. */
    payload: unknown;
    /** True once the farmer has acted on it, so a reviewed draft stops resurfacing. */
    reviewedAtUtc?: string;
}

// =============================================================================
// VOICE CLIPS (30-day processing journal, no indefinite retention)
// =============================================================================

export type VoiceClipRetentionPolicy = 'processing_30d';
export type VoiceClipStatus = 'recorded' | 'queued' | 'parsing' | 'parsed' | 'failed';

export interface VoiceClipCacheRecord {
    id: string;
    farmId: string;
    plotId?: string;
    cropCycleId?: string;
    pendingAiJobId?: number;
    recordedAtUtc: string;
    durationMs?: number;
    mimeType: string;
    sizeBytes: number;
    /**
     * The clip's audio bytes, IN PLAINTEXT. **This is what every live clip
     * carries today**, not a pre-v18 remnant.
     *
     * ⚠️ THIS COMMENT USED TO SAY the opposite — *"rows written before v18 carry
     * this; rows written after v18 carry the sealed triple"*. That stopped being
     * true and was never corrected, and a reader who trusted it concluded that
     * an unsealed row must be a rare legacy leftover. It is not. Verified in
     * source: `BackendAiClient.persistProcessingVoiceClip` is the only live
     * writer and it writes `localBlob` and never the sealed triple, and
     * `VoiceClipRetention.persistVoiceClip` — the only function that seals — has
     * ZERO callers in `src/clients`.
     *
     * The sealed triple below is therefore ASPIRATIONAL on the write path: real,
     * tested, and unreached. `VoiceClipRetention.ts` header and founder ruling
     * D9 both record that wiring it is the next item in this area.
     *
     * Do not restore the old wording without first checking the writer.
     *
     * spec: data-principle-spine-2026-05-05/05.3; founder ruling D9 (2026-08-14)
     */
    localBlob?: Blob;
    /**
     * AES-GCM ciphertext (includes the 16-byte auth tag). Written by
     * `sealVoiceClip` in `infrastructure/security/voiceEnvelope.ts`.
     *
     * spec: data-principle-spine-2026-05-05/05.3
     */
    ciphertext?: Uint8Array;
    /**
     * 96-bit random IV used for the AES-GCM seal. Reuse with the same
     * DEK is catastrophic; `sealVoiceClip` generates a fresh IV per call.
     *
     * spec: data-principle-spine-2026-05-05/05.3
     */
    iv?: Uint8Array;
    /**
     * Opaque DEK identifier issued by the backend. Used on read to
     * resolve back to plaintext key bytes via the resolve endpoint
     * (see `tenantDekClient.resolveDek`).
     *
     * spec: data-principle-spine-2026-05-05/05.3
     */
    wrappedDekId?: string;
    /**
     * Migration marker — v18 upgrade tags legacy plaintext rows with
     * this flag so the read/write path knows to re-seal them on next
     * access. See `infrastructure/storage/dexie/versions/v18.ts`.
     *
     * spec: data-principle-spine-2026-05-05/05.3
     */
    needsResealOnNextAccess?: boolean;
    /**
     * HS256 `kid` claim from the consent token that was active when
     * this clip was sealed. Lets the audit / export path pin clips
     * to a specific consent state + signing key generation. Optional
     * (undefined on pre-v19 rows + on rows sealed before a consent
     * token is available).
     *
     * spec: data-principle-spine-2026-05-05/06.5
     */
    consentTokenKid?: string;
    /** Cross-ref into retained S3 tier after archiveToRetainedTierIfConsented. Local 30d sweep still deletes the row; S3 holds the canonical copy. spec: voice-diary-e2e-2026-05-17 (D.17) */
    s3RetainedKey?: string;
    /**
     * Why the retained-tier archive did not happen, prefixed with the machine
     * reason (`persist_failed: …`). Cleared the moment an archive succeeds.
     *
     * Founder ruling D9 promises a consenting farmer he can hear any day
     * forever, and this archive is what buys that. When it failed, NOTHING
     * recorded it — the caller discarded the result and the only trace was a
     * `console.warn` in a WebView. Telemetry now tells a human today; this field
     * is what lets anyone act tomorrow, and it is the query a future re-attempt
     * sweep would run.
     *
     * NON-INDEXED, like `result` on `PendingAiJobRecord` — no Dexie version
     * bump, so no one-way upgrade for APK users. Absent on old rows, which
     * reads as "never attempted or never failed" and is exactly true.
     */
    retainedArchiveError?: string;
    /** POST attempts made on the last archive call. Bounded at 2. */
    retainedArchiveAttempts?: number;
    /** When the last archive attempt ran, successful or not. */
    retainedArchiveLastAttemptAtUtc?: string;
    status: VoiceClipStatus;
    retentionPolicy: VoiceClipRetentionPolicy;
    expiresAtUtc: string;
    createdAt: string;
    updatedAt: string;
    lastError?: string;
}

// =============================================================================
// SYNC CURSORS
// =============================================================================

export interface SyncCursor {
    tableName: string;
    lastSyncAt: string;
    serverCursor?: string;
    version: number;
}

// =============================================================================
// APP META (Key-Value store)
// =============================================================================

export interface AppMetaEntry {
    key: string;
    value: unknown;
    updatedAt: string;
}

// =============================================================================
// REFERENCE DATA CACHE
// =============================================================================

export type ReferenceDataKey =
    | 'scheduleTemplates'
    | 'cropTypes'
    | 'activityCategories'
    | 'costCategories';

export interface ReferenceDataRecord {
    key: ReferenceDataKey;
    data: unknown;
    versionHash: string;
    updatedAt: string;
}

// =============================================================================
// SYNC CACHE TABLES
// =============================================================================

export interface DayLedgerCacheRecord {
    id: string;
    farmId: string;
    dateKey: string;
    payload: unknown;
    updatedAt: string;
}

export interface PlannedActivityOverrideMarkers {
    /** Arbitrary override marker map — keys are marker names, values are booleans or strings */
    [key: string]: boolean | string | null | undefined;
}

export interface PlannedTaskCacheRecord {
    id: string;
    cropCycleId: string;
    plannedDate: string;
    payload: unknown;
    updatedAt: string;
    /** CEI Phase 1 — template activity that sourced this planned activity */
    sourceTemplateActivityId?: string | null;
    /** CEI Phase 1 — override markers applied to this activity */
    overrideMarkers?: PlannedActivityOverrideMarkers | null;
}

export interface FarmCacheRecord {
    id: string;
    ownerAccountId?: string;
    payload: unknown;
    syncStatus?: string;
    serverUpdatedAt?: string;
    updatedAt: string;
    modifiedAtUtc?: string;
}

export interface PlotCacheRecord {
    id: string;
    farmId: string;
    ownerAccountId?: string;
    payload: unknown;
    syncStatus?: string;
    serverUpdatedAt?: string;
    updatedAt: string;
    modifiedAtUtc?: string;
}

export interface FarmBoundaryCacheRecord {
    id: string;
    farmId: string;
    ownerAccountId: string;
    payload: unknown;
    syncStatus: string;
    serverUpdatedAt: string;
    updatedAt: string;
}

export interface PlotAreaCacheRecord {
    id: string;
    plotId: string;
    farmId: string;
    ownerAccountId: string;
    payload: unknown;
    syncStatus: string;
    serverUpdatedAt: string;
    updatedAt: string;
}

export interface CropCycleCacheRecord {
    id: string;
    farmId: string;
    plotId: string;
    payload: unknown;
    updatedAt: string;
}

export interface CostEntryCacheRecord {
    id: string;
    farmId: string;
    payload: unknown;
    updatedAt: string;
}

export interface FinanceCorrectionCacheRecord {
    id: string;
    costEntryId: string;
    payload: unknown;
    updatedAt: string;
}

/**
 * Labour V2 R1 Task 3.5c — one server-acknowledged attendance ruling, as
 * pulled. Grain matches ux_attendance_marks_farm_operator_day. This store is
 * the ACKNOWLEDGED half only; unsynced intent lives in `mutationQueue`, and
 * `features/labour/data/attendanceLocal.ts` is the one read that merges the
 * two with a `source` label (P10: intent is never rendered as saved).
 */
export interface AttendanceMarkCacheRecord {
    id: string;
    farmId: string;
    fieldOperatorId: string;
    workDate: string;
    payload: AttendanceMarkDto;
    updatedAt: string;
}

// =============================================================================
// SCHEDULE TEMPLATE — shape inside referenceData.data array
// =============================================================================

/** Shape of each item stored inside referenceData['scheduleTemplates'].data */
export interface ScheduleTemplateCacheItem {
    id: string;
    name?: string;
    /** CEI Phase 1 — set by server; backfilled to 1 for legacy rows */
    version?: number;
    /** CEI Phase 1 — 'Public' | 'Tenant'; backfilled to 'Public' for legacy rows */
    tenantScope?: string;
    /** CEI Phase 1 — null for system templates */
    createdByUserId?: string | null;
    previousVersionId?: string | null;
    derivedFromTemplateId?: string | null;
    publishedAtUtc?: string | null;
    [key: string]: unknown;
}

// =============================================================================
// ATTENTION CARDS (CEI Phase 1)
// =============================================================================

export interface AttentionCardCacheRecord {
    cardId: string;
    farmId: string;
    rank: string;
    computedAtUtc: string;
    // mirror of AttentionCardDto fields
    farmName: string;
    plotId: string;
    plotName: string;
    cropCycleId?: string | null;
    stageName?: string | null;
    titleEn: string;
    titleMr: string;
    descriptionEn: string;
    descriptionMr: string;
    suggestedAction: string;
    suggestedActionLabelEn: string;
    suggestedActionLabelMr: string;
    overdueTaskCount?: number | null;
    latestHealthScore?: string | null;
    unresolvedDisputeCount?: number | null;
}

// =============================================================================
// VERSIONED LOG RECORD
// =============================================================================

export interface DexieLogRecord {
    /** Log ID (primary key) */
    id: string;
    /** Schema version at time of write */
    schemaVersion: number;
    /** The actual log data */
    log: DailyLog;
    /** Date string for index (YYYY-MM-DD) */
    date: string;
    /** Verification status for index */
    verificationStatus?: string;
    /** Creator operator ID for index */
    createdByOperatorId?: string;
    /** Soft-deleted flag for index */
    isDeleted: 0 | 1;
    /** Server-reported modification timestamp; used to skip stale-pull overwrites */
    serverModifiedAtUtc?: string;
}

// =============================================================================
// CEI PHASE 3 — COMPLIANCE SIGNALS (§4.6)
// =============================================================================

export interface DexieComplianceSignal {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId?: string | null;
    ruleCode: string;
    severity: string; // 'Info' | 'Watch' | 'NeedsAttention' | 'Critical'
    suggestedAction: string;
    titleEn: string;
    titleMr: string;
    descriptionEn: string;
    descriptionMr: string;
    payloadJson: string;
    firstSeenAtUtc: string;
    lastSeenAtUtc: string;
    acknowledgedAtUtc?: string | null;
    resolvedAtUtc?: string | null;
    resolutionNote?: string | null;
    isOpen: boolean;
}

// =============================================================================
// CEI PHASE 2 — TEST STACK (§4.5)
// =============================================================================

// Record types extracted to ./DexieDatabase.testTypes (Sub-plan 04 §DoD ≤800
// lines). Re-exported so existing `from '.../DexieDatabase'` imports keep working.
export type {
    DexieTestProtocol,
    DexieTestResult,
    DexieTestInstance,
    DexieTestRecommendation,
};

// =============================================================================
// CEI PHASE 4 — JOB CARDS (§4.8)
// =============================================================================

export interface DexieJobCard extends JobCard {
    /** Redundant field for Dexie compound-index compatibility */
    modifiedAtUtc: string;
}

export interface DexieWorkerProfile {
    /** PK */
    workerUserId: string;
    /** Farm this cache was fetched for (part of the profile endpoint path) */
    scopedFarmId: string;
    data: WorkerProfileData;
    cachedAtUtc: string;
}

// =============================================================================
// SUB-PLAN 04 TASK 2 — FRONTEND STORAGE UNIFICATION
// =============================================================================

/**
 * Crop blob row. The full CropProfile is stored as `data`; `id` is the crop's
 * stable id (e.g. `crop_grapes`). `updatedAtMs` lets us detect stale rows
 * during the legacy-localStorage migration without changing the CropProfile
 * schema itself.
 */
export interface CropRow {
    id: string;
    data: unknown;
    updatedAtMs: number;
}

/**
 * Farmer profile blob row. Singleton: id is always `'self'`. Storing the full
 * FarmerProfile as `data` keeps the existing FarmerProfile shape untouched
 * while moving the storage substrate from localStorage to Dexie.
 */
export interface ProfileRow {
    id: 'self';
    data: unknown;
    updatedAtMs: number;
}

/**
 * UI preferences key-value store (sidebar collapsed, theme, etc). Replaces
 * the per-key localStorage scatter for non-essential UX prefs that don't need
 * to be in localStorage's sync namespace.
 */
export interface UiPrefRow {
    key: string;
    value: unknown;
}

// =============================================================================
// ANALYTICS OUTBOX (DWC v2 §2.6 — closure-loop telemetry)
// =============================================================================

/**
 * One queued analytics event awaiting POST to `/analytics/ingest`.
 * Drained by `AnalyticsEventBus` per `ADR-2026-05-02_telemetry-batching.md`:
 * 50-row batches, 5-attempt cap, all-or-nothing batch policy.
 */
export interface AnalyticsOutboxRow {
    /** Auto-incremented by Dexie. */
    id?: number;
    /** Serialized {eventType, props} — round-tripped through JSON.parse on drain. */
    payloadJson: string;
    /** Epoch ms; secondary index used for FIFO drain ordering. */
    createdAtUtc: number;
    /** Monotonic per-row send attempts; row drops at MAX_ATTEMPTS (5). */
    attempts: number;
}
