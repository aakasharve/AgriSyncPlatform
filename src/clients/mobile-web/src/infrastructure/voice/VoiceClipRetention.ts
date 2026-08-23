// spec: data-principle-spine-2026-05-05/05.3
//
// VoiceClipRetention — 30-day processing-journal lifecycle for voice
// clips on-device. Phase 05 sub-phase 05.3 extends this module with
// the envelope-encryption seal/open hooks so every persist hits the
// AES-GCM seal path and every read recovers plaintext via the DEK.
//
// Retention rule: clips expire 30 days after recording, and
// `purgeExpiredProcessingVoiceClips` deletes them on the next sweep —
// with one exception added 2026-08-23, see below.
//
// spec: voice-diary-e2e-2026-05-17 (D.14)
//
// ADDITIVE EXTENSION — `archiveToRetainedTierIfConsented(clipId)` reads
// the user's FullHistoryJournal consent state and, when granted, calls
// `voiceDiaryApiClient.persistRetainedVoiceClip` with the sealed
// ciphertext + envelope metadata. Per supervisor risk #1, the local
// Dexie `voiceClips.id` is reused verbatim as the server PK so the
// unified VoiceDiary view de-dups cleanly.
//
// spec: dfes-companion-2026-07-11 (farm-memory) — founder ruling
// 2026-08-23, doctrine P10.
//
// That ship left the local sweep untouched on the reasoning that "the S3
// copy holds the retained tier independently". True when the S3 copy
// exists. The archive below is best-effort and swallows its failures, so
// on a phone that was offline — the normal condition in a Tier-3 village
// — no S3 copy is made, nothing retries, and thirty days later the sweep
// deletes the only copy that ever existed. The farmer intended that
// recording to be Farm Memory, the app agreed, and it vanished without
// either of them being told.
//
// P10 says acknowledged work must be reconstructable without the
// originating device, so the local timer alone cannot be authority to
// delete. The sequence is: capture -> attempt durable storage -> SERVER
// ACKNOWLEDGEMENT -> only then is the local copy eligible for cleanup.
// `s3RetainedKey` is that acknowledgement; it is stamped only after
// `persistRetainedVoiceClip` returns.
//
// This is deliberately NOT a second deletion rule. Nothing new gets
// deleted and no clip acquires a shorter life. One class of clip —
// unsynchronised Farm Memory — stops being deleted, and
// `retryPendingRetainedArchives` gives it the way out it never had.

import { getDatabase, type VoiceClipCacheRecord, type VoiceClipStatus } from '../storage/DexieDatabase';
import { sealVoiceClip, openVoiceClip } from '../security/voiceEnvelope';
import { getCurrentTenantDek, resolveDek } from '../security/tenantDekClient';
import { agriSyncClient } from '../api/AgriSyncClient';
import { persistRetainedVoiceClip } from '../voiceDiary/voiceDiaryApiClient';

export const PROCESSING_VOICE_CLIP_RETENTION_DAYS = 30;

export function computeProcessingVoiceClipExpiry(recordedAtUtc: string): string {
    const recordedAtMs = Date.parse(recordedAtUtc);
    const baseMs = Number.isNaN(recordedAtMs) ? Date.now() : recordedAtMs;
    return new Date(baseMs + PROCESSING_VOICE_CLIP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * appMeta key holding the last answer the server gave for
 * `FullHistoryJournal`. The sweep needs to know whether this farmer has
 * Farm Memory switched on, and the sweep runs on boot and on page open,
 * including with no network. Caching the last known answer is what lets
 * the offline sweep make the right call instead of guessing.
 */
const FARM_MEMORY_ENABLED_META_KEY = 'voice_diary_farm_memory_enabled';

async function rememberFarmMemoryEnabled(enabled: boolean): Promise<void> {
    try {
        await getDatabase().appMeta.put({
            key: FARM_MEMORY_ENABLED_META_KEY,
            value: enabled,
            updatedAt: new Date().toISOString(),
        });
    } catch {
        // A cache write failing must not break the archive path. The
        // sweep falls back to asking the server, and failing that to the
        // keep-it branch.
    }
}

/**
 * Is this farmer's voice being kept as Farm Memory?
 *
 * Server first, because the server is authoritative and the answer may
 * have changed on another device. Cache second, because the sweep must
 * still work offline. And when there is neither — a device that has
 * never once heard back about consent — the answer is `true`.
 *
 * That last default is the one worth defending. It is the fail-safe
 * direction: guessing "on" costs some phone storage until the next time
 * the app reaches the server, while guessing "off" deletes recordings
 * that may be the only copy in existence. Unsynchronised Farm Memory is
 * never silently destroyed, and an unknown is not a licence to destroy.
 */
async function resolveFarmMemoryEnabled(): Promise<boolean> {
    try {
        const dto = await agriSyncClient.getConsent();
        const enabled = dto.fullHistoryJournal === true;
        await rememberFarmMemoryEnabled(enabled);
        return enabled;
    } catch {
        // Offline, or no consent record yet. Fall through to the cache.
    }

    try {
        const cached = await getDatabase().appMeta.get(FARM_MEMORY_ENABLED_META_KEY);
        if (cached && typeof cached.value === 'boolean') {
            return cached.value;
        }
    } catch {
        // Cache unreadable — treated the same as never written.
    }

    return true;
}

/**
 * Delete voice clips whose 30-day processing window has closed.
 *
 * Clips still awaiting durable storage are EXCLUDED. See the module
 * header: an expired clip that this farmer meant to keep, and that the
 * server has never acknowledged, is the only copy of something he was
 * promised would be kept. The timer is not authority to delete it.
 *
 * The consent lookup only happens when the answer could change the
 * outcome — that is, when at least one expiring clip has no
 * `s3RetainedKey`. On the overwhelmingly common path (nothing expired,
 * or everything expired is already in the cloud) this costs no network
 * call at all, which matters because the sweep runs on app boot.
 *
 * @returns how many rows were deleted.
 */
export async function purgeExpiredProcessingVoiceClips(nowUtc: string = new Date().toISOString()): Promise<number> {
    const db = getDatabase();
    const expired = await db.voiceClips
        .where('expiresAtUtc')
        .belowOrEqual(nowUtc)
        .toArray();

    if (expired.length === 0) {
        return 0;
    }

    const unacknowledged = expired.filter(clip => !clip.s3RetainedKey);
    if (unacknowledged.length === 0) {
        await db.voiceClips.bulkDelete(expired.map(clip => clip.id));
        return expired.length;
    }

    // Only now does consent matter, so only now do we go and find out.
    const farmMemoryEnabled = await resolveFarmMemoryEnabled();

    const deletable = farmMemoryEnabled
        // Farm Memory is on: an unacknowledged clip is unsynchronised
        // history, and it stays until the upload succeeds.
        ? expired.filter(clip => !!clip.s3RetainedKey)
        // Farm Memory is off: nothing was ever going to be uploaded, and
        // "30 days only" is exactly what this farmer was told. Unchanged
        // behaviour.
        : expired;

    if (deletable.length === 0) {
        return 0;
    }

    await db.voiceClips.bulkDelete(deletable.map(clip => clip.id));
    return deletable.length;
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
    const { dek, dekId } = await getCurrentTenantDek();
    const sealed = await sealVoiceClip(input.plaintext, dek, dekId);
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
 * no sealed fields (caller should fall back to `row.localBlob`), or when
 * the DEK can't be resolved (wrong tenant or expired wrap — caller
 * should treat as unrecoverable and surface to UI).
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
    const dek = await resolveDek(row.wrappedDekId);
    if (!dek) return null;
    return openVoiceClip(
        { ciphertext: row.ciphertext, iv: row.iv, wrappedDekId: row.wrappedDekId },
        dek,
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
 * Errors are SWALLOWED (logged) — this is a best-effort opportunistic
 * archive triggered from AiJobWorker. A failed archive does NOT block
 * the local 30-day journal; the clip is still readable locally via
 * `readVoiceClipPlaintext`. A future sweep can re-attempt.
 *
 * spec: voice-diary-e2e-2026-05-17 (D.14)
 */
export async function archiveToRetainedTierIfConsented(clipId: string): Promise<boolean> {
    let consentGranted: boolean;
    try {
        const dto = await agriSyncClient.getConsent();
        consentGranted = dto.fullHistoryJournal === true;
        // Remember it for the offline sweep — see resolveFarmMemoryEnabled.
        await rememberFarmMemoryEnabled(consentGranted);
    } catch {
        // No prior consent record / network failure — treat as not granted.
        // Note this only skips the ARCHIVE. It does not authorise the sweep
        // to delete anything: the sweep resolves consent for itself, and a
        // clip with no s3RetainedKey survives until that upload succeeds.
        return false;
    }
    if (!consentGranted) {
        return false;
    }

    const db = getDatabase();
    const row = await db.voiceClips.get(clipId);
    if (!row) {
        return false;
    }
    if (!row.ciphertext || !row.iv || !row.wrappedDekId) {
        // Pre-v18 plaintext shape — can't archive without re-sealing first.
        // Re-seal cascade is the Phase 07 §6.5.2 hand-off. For this ship we
        // simply skip — those rows expire locally on the 30-day boundary.
        return false;
    }
    if (row.s3RetainedKey) {
        // Already archived — no-op (idempotent contract; the backend would
        // accept a repeat PUT as well, but skipping saves a round-trip).
        return false;
    }

    // Split WebCrypto AES-GCM combined output: ct_body + 16-byte auth_tag
    // (the backend stores them in separate columns per its envelope schema).
    if (row.ciphertext.byteLength <= AES_GCM_TAG_BYTES) {
        return false;
    }
    const cipherBody = row.ciphertext.subarray(0, row.ciphertext.byteLength - AES_GCM_TAG_BYTES);
    const authTag = row.ciphertext.subarray(row.ciphertext.byteLength - AES_GCM_TAG_BYTES);

    const durationSeconds = Math.max(
        1,
        Math.round((row.durationMs ?? 1000) / 1000),
    );

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
        // local sweep doesn't lose the cross-reference (Dexie v18 row
        // shape already carries `id`; v21 adds `s3RetainedKey` for the
        // pointer back to the retained tier).
        await db.voiceClips.update(clipId, {
            s3RetainedKey: result.clipId,
            updatedAt: new Date().toISOString(),
        });
        return true;
    } catch (error) {
        // Log + swallow per the best-effort contract. Higher-level
        // observability (sentry, analytics outbox) is owned by the
        // caller (AiJobWorker hook).
         
        console.warn('[voice-diary] archive failed', {
            clipId,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

/**
 * How many recordings are still waiting to reach the farmer's cloud.
 * Drives the "not yet saved" indicator: a farmer must be able to tell
 * that something has not safely synced, rather than discovering it years
 * later when he goes looking for it.
 */
export async function countPendingRetainedArchives(): Promise<number> {
    try {
        return await getDatabase().voiceClips
            .filter(clip => !clip.s3RetainedKey)
            .count();
    } catch {
        return 0;
    }
}

/** Upper bound on uploads re-attempted in a single sweep. */
export const MAX_RETAINED_ARCHIVE_RETRIES_PER_SWEEP = 5;

/**
 * Re-attempt the retained-tier upload for clips the server has never
 * acknowledged.
 *
 * spec: dfes-companion-2026-07-11 (farm-memory)
 *
 * The archive hook fires exactly once, from AiJobWorker, on a successful
 * voice parse. If that one attempt failed — offline, 500, expired token
 * — nothing ever tried again. Now that the sweep no longer deletes
 * unacknowledged clips, "never retries" would become "accumulates
 * forever", which is the storage-pressure failure mode. The answer to it
 * is to make the upload finish, not to make the recording disappear.
 *
 * Bounded on purpose: a phone returning from three weeks offline should
 * not open twenty parallel uploads on the first screen. It takes the
 * oldest few per sweep and lets subsequent sweeps drain the rest.
 * `archiveToRetainedTierIfConsented` is already idempotent and already
 * swallows its own failures, so a clip that fails again simply stays in
 * the queue.
 *
 * @returns how many clips were successfully archived this pass.
 */
export async function retryPendingRetainedArchives(): Promise<number> {
    let pending: VoiceClipCacheRecord[];
    try {
        pending = await getDatabase().voiceClips
            .filter(clip => !clip.s3RetainedKey && clip.status === 'parsed')
            .sortBy('recordedAtUtc');
    } catch {
        return 0;
    }

    // Oldest first: the clip closest to being the farmer's only surviving
    // copy of something recorded long ago is the one to rescue first.
    const batch = pending.slice(0, MAX_RETAINED_ARCHIVE_RETRIES_PER_SWEEP);
    let archived = 0;
    for (const clip of batch) {
        // Sequential, not Promise.all: these are large uploads on a weak
        // connection, and firing them together is how the whole batch
        // times out.
        if (await archiveToRetainedTierIfConsented(clip.id)) {
            archived++;
        }
    }
    return archived;
}
