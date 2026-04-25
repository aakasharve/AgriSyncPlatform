import { getDatabase } from '../storage/DexieDatabase';

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
