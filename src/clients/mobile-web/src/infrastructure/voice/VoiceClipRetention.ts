// spec: data-principle-spine-2026-05-05/05.3
//
// VoiceClipRetention — 30-day processing-journal lifecycle for voice
// clips on-device. Phase 05 sub-phase 05.3 extends this module with
// the envelope-encryption seal/open hooks so every persist hits the
// AES-GCM seal path and every read recovers plaintext via the DEK.
//
// Retention rule is unchanged: clips expire 30 days after recording,
// `purgeExpiredProcessingVoiceClips` deletes them on the next sweep.

import { getDatabase, type VoiceClipCacheRecord, type VoiceClipStatus } from '../storage/DexieDatabase';
import { sealVoiceClip, openVoiceClip } from '../security/voiceEnvelope';
import { getCurrentTenantDek, resolveDek } from '../security/tenantDekClient';

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
