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

export async function purgeExpiredProcessingVoiceClips(nowUtc: string = new Date().toISOString()): Promise<number> {
    const db = getDatabase();
    return db.voiceClips
        .where('expiresAtUtc')
        .belowOrEqual(nowUtc)
        .delete();
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
    } catch {
        // No prior consent record / network failure — treat as not granted.
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
