/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice") - the SERVER WINS on download.
 *
 * The pull carries `ownerMessages`, `ownerClips` (metadata only) and `ownerMessageStates`, each FULL on every pull, only for farms the schedule mechanism is switched on for
 * and only to a phone that asks for the new format. Each present key REPLACES the phone's copy whole (a disposable server cache in `referenceData`, like
 * `ownScheduleCarries`; no new store). An ABSENT key (an older server, a farm switched off) leaves the stores as they are. A row that cannot be read is skipped and counted,
 * never stored half. When the clip list is replaced, the kept clip bytes of a clip the server no longer lists, or whose content hash changed, leave the phone.
 * A decision or an answer made on this phone and not yet answered is never touched here: it is in the mutation queue (P10). Never throws into the pull.
 */
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { BYTES_PREFIX } from '../../../scheduler/ownerVoice/ownerVoiceStore';
import { parseOwnerClip, parseOwnerMessage, parseOwnerState, type OwnerClipMeta } from '../../../scheduler/ownerVoice/ownerVoiceTypes';

export interface OwnerVoiceReconcileOutcome { messages: number; clips: number; states: number; skipped: number }

export async function reconcileOwnerVoice(db: AgriLogDatabase, payload: SyncPullResponse): Promise<OwnerVoiceReconcileOutcome> {
    const raw = payload as SyncPullResponse & { ownerMessages?: unknown; ownerClips?: unknown; ownerMessageStates?: unknown };
    const outcome: OwnerVoiceReconcileOutcome = { messages: 0, clips: 0, states: 0, skipped: 0 };
    const now = new Date().toISOString();
    try {
        const keep = async <T>(key: 'ownerMessages' | 'ownerClips' | 'ownerMessageStates', list: unknown, read: (v: unknown) => T | null): Promise<T[]> => {
            const rows = (list as unknown[]).map(read).filter((x): x is T => x !== null);
            outcome.skipped += (list as unknown[]).length - rows.length;
            await db.referenceData.put({ key, data: rows, versionHash: String(rows.length), updatedAt: now });
            return rows;
        };
        if (Array.isArray(raw.ownerMessages)) outcome.messages = (await keep('ownerMessages', raw.ownerMessages, parseOwnerMessage)).length;
        if (Array.isArray(raw.ownerMessageStates)) outcome.states = (await keep('ownerMessageStates', raw.ownerMessageStates, parseOwnerState)).length;
        if (Array.isArray(raw.ownerClips)) {
            const clips: OwnerClipMeta[] = await keep('ownerClips', raw.ownerClips, parseOwnerClip);
            outcome.clips = clips.length;
            const current = new Map(clips.map(c => [`${BYTES_PREFIX}${c.id}:${c.contentHash}`, true]));
            for (const k of (await db.referenceData.toCollection().primaryKeys()).map(String)) {
                if (k.startsWith(BYTES_PREFIX) && !current.has(k)) await db.referenceData.delete(k as never);
            }
        }
        if (outcome.skipped > 0) console.warn(JSON.stringify({ component: 'ownerVoiceReconciler', action: 'owner_voice_rows_skipped', skipped: outcome.skipped }));
    } catch (error) {
        console.warn(JSON.stringify({ component: 'ownerVoiceReconciler', action: 'owner_voice_not_kept_this_pull', reason: error instanceof Error ? error.message : String(error) }));
    }
    return outcome;
}
