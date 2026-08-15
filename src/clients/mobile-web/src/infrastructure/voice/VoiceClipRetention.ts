// spec: data-principle-spine-2026-05-05/05.3
//
// VoiceClipRetention — 30-day processing-journal lifecycle for voice
// clips on-device. Phase 05 sub-phase 05.3 extends this module with
// the envelope-encryption seal/open hooks so every persist hits the
// AES-GCM seal path and every read recovers plaintext via the DEK.
//
// Retention rule is unchanged: clips expire 30 days after recording,
// `purgeExpiredProcessingVoiceClips` deletes them on the next sweep.
//
// spec: voice-diary-e2e-2026-05-17 (D.14)
//
// ADDITIVE EXTENSION — `archiveToRetainedTierIfConsented(clipId)` reads
// the user's FullHistoryJournal consent state and, when granted, calls
// `voiceDiaryApiClient.persistRetainedVoiceClip` with the sealed
// ciphertext + envelope metadata. `purgeExpiredProcessingVoiceClips`
// is UNCHANGED — the local 30-day sweep still runs because the S3 copy
// holds the retained tier independently. Per supervisor risk #1, the
// local Dexie `voiceClips.id` is reused verbatim as the server PK so
// the unified VoiceDiary view de-dups cleanly.

import { getDatabase, type VoiceClipCacheRecord, type VoiceClipStatus } from '../storage/DexieDatabase';
import { sealVoiceClip, openVoiceClip, type VoiceClipBinding } from '../security/voiceEnvelope';
import { getCurrentTenantDek, resolveDek } from '../security/tenantDekClient';
import { agriSyncClient } from '../api/AgriSyncClient';
import { persistRetainedVoiceClip } from '../voiceDiary/voiceDiaryApiClient';
import { emitClientError } from '../../core/telemetry/eventEmitters';

export const PROCESSING_VOICE_CLIP_RETENTION_DAYS = 30;

export function computeProcessingVoiceClipExpiry(recordedAtUtc: string): string {
    const recordedAtMs = Date.parse(recordedAtUtc);
    const baseMs = Number.isNaN(recordedAtMs) ? Date.now() : recordedAtMs;
    return new Date(baseMs + PROCESSING_VOICE_CLIP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * DISABLED BY FOUNDER RULING D9 (2026-08-14) — VOICE RECORDINGS ARE KEPT
 * FOREVER. THIS IS A PRODUCT PRIVILEGE, NOT A RETENTION WINDOW.
 *
 * > *"He can actually listen to everything that was spoken on that day, by
 * > whoever spoke."*
 *
 * This function WORKED. That was the problem: it was the only retention policy
 * in the client that actually functioned, and it was quietly deleting the
 * feature thirty days at a time. The earlier 30-day ruling it implemented was
 * made in the belief that the clips were encrypted; they are not (see below),
 * and the ruling was reversed once that came to light.
 *
 * WHY A NO-OP RATHER THAN DELETING THE FUNCTION AND ITS THREE CALL SITES.
 * The sweep points — app boot, the voice-diary page, and the parse path — are
 * the right places for a lifecycle hook, and D9 explicitly orders this switched
 * off *before* anything else in this area. Removing the seam would make the
 * next change (a real, consented lifecycle) a re-plumbing job instead of an
 * edit, and it would silently drop the call sites from review. Keeping the
 * function and emptying it means one reversible change that cannot miss a
 * caller.
 *
 * `expiresAtUtc` is still WRITTEN on persist, and deliberately so: it is an
 * indexed column, it records when the old policy would have fired, and nothing
 * reads it now. Removing it is a Dexie change and Dexie changes are one-way for
 * APK users, so it does not ride along with a behavioural fix.
 *
 * 🔴 WHAT THIS MAKES URGENT, STATED HERE BECAUSE IT IS NOW WORSE: every clip is
 * PLAIN, OPENABLE AUDIO. `sealVoiceClip` exists in this codebase with zero
 * callers on the live write path. Thirty days of plaintext was a bounded risk;
 * forever is an unbounded and permanently growing one. D9 makes encryption
 * non-optional and it is the next item in this area, not a later one.
 *
 * @returns always 0 — nothing is deleted. The signature is unchanged so the
 *          three call sites keep compiling and keep reporting a real number.
 */
export async function purgeExpiredProcessingVoiceClips(_nowUtc: string = new Date().toISOString()): Promise<number> {
    return 0;
}

/**
 * The row identity a clip's ciphertext is sealed to, resolved from data
 * this device already holds. **No network call** — `farms` is the local
 * Dexie cache, so a farmer with no connectivity can still open their own
 * clip. (The `resolveDek` round-trip on the read path is a separate,
 * known offline gap owned by §8 of the server-authoritative plan; this
 * function deliberately does not add a second one.)
 *
 * Returns `null` when the clip's farm is not cached locally. Callers must
 * treat that as "cannot open yet", never as "open without a binding" —
 * an unbound open is exactly the hole the binding closes.
 */
export async function resolveVoiceClipBinding(
    clipId: string,
    farmId: string,
): Promise<VoiceClipBinding | null> {
    const farm = await getDatabase().farms.get(farmId);
    const ownerAccountId = farm?.ownerAccountId;
    if (!ownerAccountId) {
        return null;
    }
    return { clipId, ownerAccountId: String(ownerAccountId) };
}

/**
 * Input shape for `persistVoiceClip`. Plaintext goes in, sealed row
 * comes out — the caller never touches the cipher.
 */
export interface PersistVoiceClipInput {
    id: string;
    farmId: string;
    plotId?: string;
    cropCycleId?: string;
    pendingAiJobId?: number;
    recordedAtUtc: string;
    durationMs?: number;
    mimeType: string;
    /** Raw voice bytes from MediaRecorder. Sealed before write. */
    plaintext: Uint8Array;
    /** Optional initial status; defaults to 'queued' (parser will pick it up). */
    status?: VoiceClipStatus;
}

/**
 * Seal a voice clip under the current tenant DEK and write it to
 * Dexie. The cached DEK is fetched lazily via `getCurrentTenantDek`
 * — first call per session round-trips to the backend, subsequent
 * calls hit the in-memory cache.
 *
 * spec: data-principle-spine-2026-05-05/05.3
 */
export async function persistVoiceClip(input: PersistVoiceClipInput): Promise<void> {
    // Bind the seal to the row it is about to occupy. Resolved BEFORE the
    // DEK fetch so an unbindable clip fails on the cheap local read rather
    // than after a network round-trip.
    const binding = await resolveVoiceClipBinding(input.id, input.farmId);
    if (!binding) {
        throw new Error(
            `persistVoiceClip: cannot seal clip ${input.id} — farm ${input.farmId} is not in the local cache, `
            + 'so the owner account that binds the seal is unknown. Sealing unbound would let this ciphertext '
            + "be moved into another clip's row undetected.",
        );
    }
    const { dek, dekId } = await getCurrentTenantDek();
    const sealed = await sealVoiceClip(input.plaintext, dek, dekId, binding);
    const nowIso = new Date().toISOString();
    const row: VoiceClipCacheRecord = {
        id: input.id,
        farmId: input.farmId,
        plotId: input.plotId,
        cropCycleId: input.cropCycleId,
        pendingAiJobId: input.pendingAiJobId,
        recordedAtUtc: input.recordedAtUtc,
        durationMs: input.durationMs,
        mimeType: input.mimeType,
        sizeBytes: input.plaintext.byteLength,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        wrappedDekId: sealed.wrappedDekId,
        status: input.status ?? 'queued',
        retentionPolicy: 'processing_30d',
        expiresAtUtc: computeProcessingVoiceClipExpiry(input.recordedAtUtc),
        createdAt: nowIso,
        updatedAt: nowIso,
    };
    await getDatabase().voiceClips.put(row);
}

/**
 * Read a voice clip and return its plaintext bytes. Returns `null` when
 * the clip is missing, when its row is the pre-v18 plaintext shape with
 * no sealed fields (caller should fall back to `row.localBlob`), when the
 * seal binding can't be rebuilt (the clip's farm is not cached locally),
 * or when the DEK can't be resolved (wrong tenant or expired wrap —
 * caller should treat as unrecoverable and surface to UI).
 *
 * Throws when the DEK resolves but the ciphertext fails the GCM auth
 * tag (tampered storage). Throw-on-tamper is intentional — we'd rather
 * crash the read than silently return wrong bytes.
 *
 * spec: data-principle-spine-2026-05-05/05.3
 */
export async function readVoiceClipPlaintext(clipId: string): Promise<Uint8Array | null> {
    const row = await getDatabase().voiceClips.get(clipId);
    if (!row) return null;
    if (!row.ciphertext || !row.iv || !row.wrappedDekId) {
        // Legacy pre-v18 shape; caller decides how to handle plaintext blob.
        return null;
    }
    // Rebuild the same binding the seal was made under. Local read, no
    // network — see `resolveVoiceClipBinding`.
    const binding = await resolveVoiceClipBinding(clipId, row.farmId);
    if (!binding) return null;
    const dek = await resolveDek(row.wrappedDekId);
    if (!dek) return null;
    return openVoiceClip(
        { ciphertext: row.ciphertext, iv: row.iv, wrappedDekId: row.wrappedDekId },
        dek,
        binding,
    );
}

// =============================================================================
// VOICE DIARY E2E — retained-tier archive (D.14)
// =============================================================================

/** WebCrypto AES-GCM auth-tag width — always 16 bytes (NIST SP 800-38D §5.2.1.2). */
const AES_GCM_TAG_BYTES = 16;

function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
}

/**
 * Why an archive attempt did not put the clip in the permanent tier.
 *
 * SPLIT BY ONE QUESTION, and only one: **is a consenting farmer's clip now
 * missing from the archive he was promised?** Everything on the left is "no
 * promise is outstanding" and must stay silent — the overwhelming majority of
 * calls land there. Everything on the left of `FAILURE` below is reported.
 */
export type VoiceClipArchiveSkipReason =
    /** He never asked for the permanent tier. Nothing was promised. */
    | 'consent_not_granted'
    /** Already in the archive. The promise is kept. */
    | 'already_archived'
    /**
     * The consent read itself failed, so we do not know whether a promise
     * exists. Recorded on the row, deliberately NOT reported: this fires on
     * ordinary flaky connectivity, the clip is untouched on the phone, and a
     * report per flaky read would bury the failures that matter. See the
     * residual note in the task report.
     */
    | 'consent_unknown';

export type VoiceClipArchiveFailureReason =
    /** The POST to the retained tier failed. THE DEFECT THIS TYPE EXISTS FOR. */
    | 'persist_failed'
    /** Consent granted, but the clip row is gone from Dexie. */
    | 'clip_row_missing'
    /** Pre-v18 plaintext row; cannot archive without re-sealing (Phase 07 §6.5.2). */
    | 'unsealed_legacy_row'
    /** Ciphertext shorter than the AES-GCM tag — nothing coherent to send. */
    | 'ciphertext_malformed';

export type VoiceClipArchiveOutcome =
    | { readonly status: 'archived'; readonly clipId: string; readonly retainedKey: string; readonly attempts: number }
    | { readonly status: 'skipped'; readonly clipId: string; readonly reason: VoiceClipArchiveSkipReason }
    | {
        readonly status: 'failed';
        readonly clipId: string;
        readonly reason: VoiceClipArchiveFailureReason;
        readonly message: string;
        /** POST attempts actually made. 0 when we never got as far as the wire. */
        readonly attempts: number;
    };

/**
 * How many times one call will try the wire before giving up.
 *
 * TWO, and bounded by construction rather than by a classifier.
 *
 * The backend is idempotent on `clipId` and says so in the adapter that
 * implements it — *"the frontend may re-fire the archive call after a flaky
 * network — same Dexie PK lands here and we must not double-write"*
 * (`S3RetainedBlobStore.PersistAsync`). It was BUILT expecting a re-fire that
 * the client never sent. Verified in that source, not taken from the comment
 * in this file.
 *
 * So a second attempt costs one request and cannot double-write. A permanently
 * malformed clip costs two requests instead of one, once — not an unbounded
 * loop, and no error classifier to get wrong.
 */
const MAX_PERSIST_ATTEMPTS = 2;

/** `client.error` drops any payload with a non-UUID `farmId`; see `reportArchiveFailure`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE PLACE A HUMAN SEES THIS.
 *
 * `emitClientError` -> `eventBus.enqueue` -> `db.analyticsOutbox` ->
 * `POST /analytics/ingest`, rendered on `AdminOpsPage`. Offline-durable, which
 * matters exactly here: the device this fires on is one whose network just
 * failed.
 *
 * REPORTED FROM INSIDE THIS FUNCTION, NOT BY THE CALLER, and that is the fix.
 * The old contract said *"Higher-level observability … is owned by the caller
 * (AiJobWorker hook)"* while the caller discarded the return value entirely —
 * both halves pointing at the other and neither reporting. This is the only
 * place that knows WHY the archive did not happen, so it is the only place that
 * can report it accurately, and putting it here means a second caller cannot
 * reintroduce the defect by forgetting.
 *
 * `farmId` is guarded because `emit` DROPS a payload that fails its schema
 * (`eventEmitters.ts:33-40`) — a malformed field here would silently swallow the
 * report inside the code written to stop swallowing reports.
 */
function reportArchiveFailure(
    clipId: string,
    reason: VoiceClipArchiveFailureReason,
    message: string,
    attempts: number,
    farmId?: string,
): void {
    try {
        emitClientError({
            ...(farmId && UUID_RE.test(farmId) ? { farmId } : {}),
            message:
                `[voice-diary] retained archive FAILED reason=${reason} clipId=${clipId} `
                + `attempts=${attempts}: ${message}`,
        });
    } catch {
        // The telemetry bus must never break the archive path. The console line
        // below still happens either way.
    }

    console.error(JSON.stringify({
        level: 'error',
        component: 'VoiceClipRetention',
        message: 'retained archive failed',
        clipId,
        reason,
        attempts,
        error: message,
        timestamp: new Date().toISOString(),
    }));
}

/**
 * Record the outcome ON THE CLIP, so it outlives this process.
 *
 * Telemetry tells a human today; this is what lets anyone act tomorrow. All
 * three fields are NON-INDEXED, so no Dexie version bump — the chain was just
 * repaired after a collision and `DATABASE_VERSION` stays 24.
 *
 * Cleared on success, so the row never claims a stale failure.
 */
async function recordArchiveAttempt(
    clipId: string,
    fields: Partial<Pick<VoiceClipCacheRecord,
        'retainedArchiveError' | 'retainedArchiveAttempts' | 'retainedArchiveLastAttemptAtUtc'>>,
): Promise<void> {
    try {
        await getDatabase().voiceClips.update(clipId, {
            ...fields,
            updatedAt: new Date().toISOString(),
        });
    } catch {
        // A row that vanished mid-flight is already covered by the outcome the
        // caller is holding. Never let bookkeeping mask the real result.
    }
}

/**
 * Archive a locally-sealed voice clip to the retained S3 tier IF the
 * user has granted `FullHistoryJournal` consent. No-op otherwise.
 *
 * Flow:
 *   1. Check `agriSyncClient.getConsent().fullHistoryJournal` — bail if false.
 *   2. Read the sealed row from Dexie. Bail if missing or pre-v18 plaintext.
 *   3. Split the WebCrypto combined ciphertext into (ct_body, auth_tag).
 *   4. POST to `/shramsafal/voice-diary/persist` with the local clip id
 *      reused as the server PK (supervisor risk #1 — de-dup contract).
 *
 * WHAT CHANGED, AND WHY IT MATTERED (founder ruling D9)
 * -----------------------------------------------------
 * D9 promises a consenting farmer he can listen back to any day, forever.
 * Lifting the local 30-day expiry is precisely what this archive step buys, so
 * when it failed the clip dropped out of the Voice Diary thirty days later.
 *
 * This function used to return a bare `boolean`, and `false` meant seven
 * different things — "he never consented", "already done", and "the upload
 * failed" were indistinguishable. So the caller could not have reported the
 * failure even if it had tried, and it did not try: it discarded the value and
 * marked the job completed. The only trace was a `console.warn` inside a WebView
 * on a farmer's Android, which nobody can read.
 *
 * NOTE ON WHAT IS *NOT* HAPPENING: the audio bytes are still on the phone.
 * `purgeExpiredProcessingVoiceClips` is a hard-coded no-op under D9. This was
 * never data destruction — it is a broken promise the farmer cannot tell apart
 * from data destruction, and the fix is to stop breaking it silently.
 *
 * Now: a discriminated outcome, one bounded re-attempt, telemetry to a sink that
 * exists, and a durable marker on the row. The ordinary path — consent granted,
 * upload works — writes nothing extra and emits nothing.
 *
 * spec: voice-diary-e2e-2026-05-17 (D.14); founder ruling D9 (2026-08-14)
 */
export async function archiveToRetainedTierIfConsented(clipId: string): Promise<VoiceClipArchiveOutcome> {
    let consentGranted: boolean;
    try {
        const dto = await agriSyncClient.getConsent();
        consentGranted = dto.fullHistoryJournal === true;
    } catch {
        // We do not know whether a promise exists. Record, do not report.
        await recordArchiveAttempt(clipId, {
            retainedArchiveError: 'consent_unknown: consent could not be read',
            retainedArchiveLastAttemptAtUtc: new Date().toISOString(),
        });
        return { status: 'skipped', clipId, reason: 'consent_unknown' };
    }
    if (!consentGranted) {
        return { status: 'skipped', clipId, reason: 'consent_not_granted' };
    }

    // Past this line consent IS granted, so every remaining exit that is not
    // `archived` leaves a promise unkept and is reported.
    const db = getDatabase();
    const row = await db.voiceClips.get(clipId);
    if (!row) {
        const message = 'consent is granted but the clip row is not in Dexie';
        reportArchiveFailure(clipId, 'clip_row_missing', message, 0);
        return { status: 'failed', clipId, reason: 'clip_row_missing', message, attempts: 0 };
    }
    if (row.s3RetainedKey) {
        // Already archived — the promise is kept. Silent, and no round-trip.
        return { status: 'skipped', clipId, reason: 'already_archived' };
    }
    if (!row.ciphertext || !row.iv || !row.wrappedDekId) {
        // Pre-v18 plaintext shape — can't archive without re-sealing first.
        // Re-seal cascade is the Phase 07 §6.5.2 hand-off. Reported rather than
        // skipped: under D9 these no longer "expire locally", they simply never
        // reach the archive, and nothing else was counting them.
        const message = 'pre-v18 unsealed row cannot be archived without a re-seal (Phase 07 §6.5.2)';
        reportArchiveFailure(clipId, 'unsealed_legacy_row', message, 0, row.farmId);
        await recordArchiveAttempt(clipId, {
            retainedArchiveError: `unsealed_legacy_row: ${message}`,
            retainedArchiveLastAttemptAtUtc: new Date().toISOString(),
        });
        return { status: 'failed', clipId, reason: 'unsealed_legacy_row', message, attempts: 0 };
    }

    // Split WebCrypto AES-GCM combined output: ct_body + 16-byte auth_tag
    // (the backend stores them in separate columns per its envelope schema).
    if (row.ciphertext.byteLength <= AES_GCM_TAG_BYTES) {
        const message = `ciphertext is ${row.ciphertext.byteLength}B, at or under the ${AES_GCM_TAG_BYTES}B auth tag`;
        reportArchiveFailure(clipId, 'ciphertext_malformed', message, 0, row.farmId);
        await recordArchiveAttempt(clipId, {
            retainedArchiveError: `ciphertext_malformed: ${message}`,
            retainedArchiveLastAttemptAtUtc: new Date().toISOString(),
        });
        return { status: 'failed', clipId, reason: 'ciphertext_malformed', message, attempts: 0 };
    }
    const cipherBody = row.ciphertext.subarray(0, row.ciphertext.byteLength - AES_GCM_TAG_BYTES);
    const authTag = row.ciphertext.subarray(row.ciphertext.byteLength - AES_GCM_TAG_BYTES);

    const durationSeconds = Math.max(
        1,
        Math.round((row.durationMs ?? 1000) / 1000),
    );

    let lastError = 'unknown';
    for (let attempt = 1; attempt <= MAX_PERSIST_ATTEMPTS; attempt++) {
        try {
            const result = await persistRetainedVoiceClip({
                clipId: row.id,
                recordedAtUtc: row.recordedAtUtc,
                cipherBase64: uint8ToBase64(cipherBody),
                dekId: row.wrappedDekId,
                ivBase64: uint8ToBase64(row.iv),
                authTagBase64: uint8ToBase64(authTag),
                durationSeconds,
                // Language is not persisted on the local Dexie row today; the
                // backend Language column is informational. Default to a
                // sensible neutral until per-clip language detection lands.
                language: 'mr-IN',
            });

            // Stamp the local row with the server's clip pointer so a future
            // local sweep doesn't lose the cross-reference, and CLEAR any
            // failure recorded by an earlier attempt so the row cannot keep
            // claiming a failure that has since been repaired.
            await db.voiceClips.update(clipId, {
                s3RetainedKey: result.clipId,
                retainedArchiveError: undefined,
                retainedArchiveAttempts: attempt,
                retainedArchiveLastAttemptAtUtc: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            return { status: 'archived', clipId, retainedKey: result.clipId, attempts: attempt };
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
    }

    reportArchiveFailure(clipId, 'persist_failed', lastError, MAX_PERSIST_ATTEMPTS, row.farmId);
    await recordArchiveAttempt(clipId, {
        retainedArchiveError: `persist_failed: ${lastError}`,
        retainedArchiveAttempts: MAX_PERSIST_ATTEMPTS,
        retainedArchiveLastAttemptAtUtc: new Date().toISOString(),
    });
    return {
        status: 'failed',
        clipId,
        reason: 'persist_failed',
        message: lastError,
        attempts: MAX_PERSIST_ATTEMPTS,
    };
}
