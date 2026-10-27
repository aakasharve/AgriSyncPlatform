/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-12, LP-15, LP-24, V-5)
 *
 * The PHONE-SIDE link between a recording and the log it became. The clip row (`db.voiceClips`) has
 * carried a plot and a time but never the log, so no screen could play "the recording behind this
 * log". The voice auto-save now stamps `dailyLogId` on the clip the moment the log is on the phone.
 *
 * Same phone only, by design: a log pulled from another phone has no clip here, and its card shows no
 * ▶ (never a guessed clip). Carrying the link to other phones needs the server (PLR-D8 / PLR-D1 §5).
 */
import { getDatabase } from '../storage/DexieDatabase';
import type { VoiceClipCacheRecord } from '../storage/DexieDatabase';
import { readVoiceClipPlaintext } from './VoiceClipRetention';

/** Which recording a parse came from: the clip's key when the recorder knew it, and the moment he spoke. */
export interface RecordingRef {
    clipId?: string;
    recordedAtUtc?: string;
}

/**
 * Stamp `dailyLogId` on the clip of this recording. Returns the clip's id, or null when this phone holds
 * no such clip (then nothing is linked and nothing is guessed).
 *
 * The clip is found by its key first. When the recorder had no key (its pre-processing fell back, so the
 * parser minted its own), the ONE unlinked clip recorded at exactly that instant is used — the parser
 * stores the recorder's own `recordedAtUtc` on the row (`BackendAiClient.persistProcessingVoiceClip`).
 * Two unlinked clips at the same instant are ambiguous, so neither is linked.
 */
export async function linkClipToLog(ref: RecordingRef, dailyLogId: string): Promise<string | null> {
    const db = getDatabase();
    let row: VoiceClipCacheRecord | undefined = ref.clipId ? await db.voiceClips.get(ref.clipId) : undefined;
    if (!row && ref.recordedAtUtc) {
        const sameInstant = await db.voiceClips
            .filter(c => c.recordedAtUtc === ref.recordedAtUtc && !c.dailyLogId)
            .toArray();
        row = sameInstant.length === 1 ? sameInstant[0] : undefined;
    }
    if (!row) return null;
    await db.voiceClips.update(row.id, { dailyLogId });
    return row.id;
}

/**
 * The clips on this phone that carry one of these logs, keyed by log id.
 *
 * `dailyLogId` is not indexed (no Dexie version bump, see the record type), so this walks rows. A clip row
 * holds its audio, and a phone keeps up to 30 days of clips, so callers pass `recordedSinceUtc` (from
 * `clipScanFloor`) and only the clips recorded since then are walked, through the existing `recordedAtUtc`
 * index. Without it every clip row is walked once (one at a time, matches kept).
 */
export async function clipsForLogs(dailyLogIds: readonly string[], recordedSinceUtc?: string): Promise<Map<string, VoiceClipCacheRecord>> {
    const out = new Map<string, VoiceClipCacheRecord>();
    if (dailyLogIds.length === 0) return out;
    const wanted = new Set(dailyLogIds);
    const table = getDatabase().voiceClips;
    const scope = recordedSinceUtc ? table.where('recordedAtUtc').aboveOrEqual(recordedSinceUtc) : table.toCollection();
    const rows = await scope.filter(c => !!c.dailyLogId && wanted.has(c.dailyLogId)).toArray();
    for (const row of rows) {
        if (row.dailyLogId && hasAudio(row)) out.set(row.dailyLogId, row);
    }
    return out;
}

/** How far back a clip of these logs can have been recorded: a day before the earliest log was saved. */
const CLIP_BEFORE_LOG_MS = 24 * 60 * 60 * 1000;

/**
 * The floor for `clipsForLogs`: a clip is recorded BEFORE the log it became is saved (the parse runs in between),
 * so nothing older than a day before the earliest of these logs can be theirs. Undefined (scan all) when any
 * log has no creation time, so no clip is ever missed for want of one.
 */
export function clipScanFloor(logs: ReadonlyArray<{ meta?: { createdAtISO?: string } }>): string | undefined {
    if (logs.length === 0) return undefined;
    let earliest = Infinity;
    for (const l of logs) {
        const ms = Date.parse(l.meta?.createdAtISO ?? '');
        if (!Number.isFinite(ms)) return undefined;
        earliest = Math.min(earliest, ms);
    }
    return new Date(earliest - CLIP_BEFORE_LOG_MS).toISOString();
}

/** A clip can be played from this phone only when its bytes are here (sealed or plain). */
export function hasAudio(row: VoiceClipCacheRecord): boolean {
    return !!row.localBlob || (!!row.ciphertext && !!row.iv && !!row.wrappedDekId);
}

/** The playable audio of a clip on this phone: the sealed copy opened, else the plain copy; null when neither. */
export async function readClipAudio(row: VoiceClipCacheRecord): Promise<Blob | null> {
    const plain = await readVoiceClipPlaintext(row.id).catch(() => null);
    if (plain) return new Blob([plain as BlobPart], { type: row.mimeType });
    return row.localBlob ?? null;
}
