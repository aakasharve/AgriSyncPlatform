// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; P10 offline) - where the owner's voice lives on the phone.
//
// The three pull lists are kept whole in `referenceData` (`ownerMessages`, `ownerClips`, `ownerMessageStates`: a disposable server cache, replaced in full by every pull that
// carries them, exactly like `ownScheduleCarries`; no new store, no Dexie version). The clip BYTES are kept there too, one record per clip AND content hash
// (`ownerClipBytes:<clipId>:<hash>`): the hash in the key is why a clip whose hash is already kept is never fetched again and why a changed clip simply gets a new record.
// The bytes are fetched while online and kept, so a heard or unheard clip plays with no signal. Nothing here writes anything the farmer made.
import { apiFetch } from '../../../infrastructure/api/apiFetch';
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import {
    EMPTY_OWNER_VIEW, parseOwnerClip, parseOwnerMessage, parseOwnerState,
    type OwnerClipMeta, type OwnerMessage, type OwnerMessageState, type OwnerVoiceView, type QueuedOwnerAct,
} from './ownerVoiceTypes';

export const BYTES_PREFIX = 'ownerClipBytes:';
const bytesKey = (clipId: string, hash: string) => `${BYTES_PREFIX}${clipId}:${hash}` as const;
const LIVE = new Set(['PENDING', 'SENDING', 'FAILED']);

interface KeptClip { clipId: string; contentHash: string; mimeType: string; bytes: ArrayBuffer }

async function keptKeys(db: AgriLogDatabase): Promise<string[]> {
    return (await db.referenceData.toCollection().primaryKeys()).map(String).filter(k => k.startsWith(BYTES_PREFIX));
}

/** Keeps the bytes of one clip (replacing any older bytes of the same clip). */
export async function keepOwnerClip(db: AgriLogDatabase, meta: OwnerClipMeta, bytes: ArrayBuffer): Promise<void> {
    for (const k of await keptKeys(db)) if (k.startsWith(`${BYTES_PREFIX}${meta.id}:`)) await db.referenceData.delete(k as never);
    const data: KeptClip = { clipId: meta.id, contentHash: meta.contentHash, mimeType: meta.mimeType, bytes };
    await db.referenceData.put({ key: bytesKey(meta.id, meta.contentHash), data, versionHash: meta.contentHash, updatedAt: new Date().toISOString() });
}

/** The kept bytes of a clip, or null when this phone does not hold them. */
export async function readOwnerClipBytes(db: AgriLogDatabase, clipId: string): Promise<{ mimeType: string; bytes: ArrayBuffer } | null> {
    const key = (await keptKeys(db)).find(k => k.startsWith(`${BYTES_PREFIX}${clipId}:`));
    if (!key) return null;
    const row = (await db.referenceData.get(key as never))?.data as Partial<KeptClip> | undefined;
    const bytes = row?.bytes as { byteLength?: unknown } | undefined;
    return bytes && typeof bytes.byteLength === 'number' ? { mimeType: row?.mimeType ?? 'audio/mpeg', bytes: bytes as ArrayBuffer } : null;
}

const asList = <T>(data: unknown, read: (v: unknown) => T | null): T[] => (Array.isArray(data) ? data.map(read).filter((x): x is T => x !== null) : []);

function queuedActs(rows: ReadonlyArray<{ mutationType: string; status: string; payload: unknown }>): QueuedOwnerAct[] {
    const out: QueuedOwnerAct[] = [];
    for (const r of rows) {
        if (!LIVE.has(r.status)) continue;
        const p = (r.payload ?? {}) as Record<string, unknown>;
        if (typeof p.plotId !== 'string' || typeof p.messageId !== 'string') continue;
        if (r.mutationType === SyncMutationName.ScheduleOwnerMessageHeard) out.push({ kind: 'heard', plotId: p.plotId, messageId: p.messageId, decision: null, answer: null });
        else if (r.mutationType === SyncMutationName.ScheduleOwnerMessageDecide && (p.decision === 'accept' || p.decision === 'keep_old' || p.decision === 'take_back')) {
            out.push({ kind: 'decide', plotId: p.plotId, messageId: p.messageId, decision: p.decision, answer: null });
        } else if (r.mutationType === SyncMutationName.ScheduleOwnerMessageAnswer && (p.answer === 'first' || p.answer === 'second')) {
            out.push({ kind: 'answer', plotId: p.plotId, messageId: p.messageId, decision: null, answer: p.answer });
        }
    }
    return out;
}

/** Everything the screens read, as this phone holds it right now (messages, clip metadata, states, which clips are kept, what waits in the outbox). */
export async function readOwnerVoice(db: AgriLogDatabase = getDatabase()): Promise<OwnerVoiceView> {
    const [m, c, s] = await Promise.all([db.referenceData.get('ownerMessages'), db.referenceData.get('ownerClips'), db.referenceData.get('ownerMessageStates')]);
    const messages: OwnerMessage[] = asList(m?.data, parseOwnerMessage);
    const clips = new Map<string, OwnerClipMeta>(asList(c?.data, parseOwnerClip).map(x => [x.id, x]));
    const states: OwnerMessageState[] = asList(s?.data, parseOwnerState);
    const keptClips = new Set<string>();
    for (const k of await keptKeys(db)) {
        const rest = k.slice(BYTES_PREFIX.length);
        const at = rest.indexOf(':');
        if (at < 0) continue;
        const id = rest.slice(0, at);
        if (clips.get(id)?.contentHash === rest.slice(at + 1)) keptClips.add(id);
    }
    const queuedRows = [SyncMutationName.ScheduleOwnerMessageHeard, SyncMutationName.ScheduleOwnerMessageDecide, SyncMutationName.ScheduleOwnerMessageAnswer];
    const rows = await db.mutationQueue.where('mutationType').anyOf(queuedRows).toArray();
    if (messages.length === 0 && clips.size === 0 && states.length === 0 && rows.length === 0) return EMPTY_OWNER_VIEW;
    return { messages, clips, states, keptClips, queued: queuedActs(rows as never) };
}

export interface ClipFetchOutcome { fetched: string[]; failed: string[]; skipped: string[] }
export type ClipSend = (path: string, init: RequestInit) => Promise<Response>;

const inFlight = new Map<string, Promise<'fetched' | 'failed' | 'skipped'>>();

/**
 * While online: fetches the bytes of the named clips for one farm and keeps them. A clip whose content hash is already kept is NOT fetched again. A clip the server refuses
 * (404: a schedule this farm does not follow) or cannot give is not kept and is not an error: the card says in words that it is not on the phone yet.
 */
export async function fetchOwnerClips(db: AgriLogDatabase, farmId: string, clipIds: readonly string[], send: ClipSend = apiFetch): Promise<ClipFetchOutcome> {
    const out: ClipFetchOutcome = { fetched: [], failed: [], skipped: [] };
    const view = await readOwnerVoice(db);
    for (const id of new Set(clipIds)) {
        const meta = view.clips.get(id);
        if (!meta || view.keptClips.has(id)) { out.skipped.push(id); continue; }
        // CTO gate: read again right before fetching - another run (a pull's prefetch, an open screen) may have kept it after this run read the view: never fetch it twice.
        if (await db.referenceData.get(bytesKey(id, meta.contentHash) as never)) { out.skipped.push(id); continue; }
        const flightKey = `${farmId}:${id}:${meta.contentHash}`;
        let p = inFlight.get(flightKey);
        if (!p) {
            p = (async () => {
                try {
                    const res = await send(`/shramsafal/schedule-owner-clips/${id}?farmId=${farmId}`, { method: 'GET' });
                    if (!res.ok) return 'skipped' as const;
                    await keepOwnerClip(db, meta, await res.arrayBuffer());
                    return 'fetched' as const;
                } catch {
                    return 'failed' as const;
                } finally {
                    inFlight.delete(flightKey);
                }
            })();
            inFlight.set(flightKey, p);
        }
        out[await p].push(id);
    }
    return out;
}

/** Every clip a message needs: its own and, for a look, the two follow-ups. */
export const clipIdsOf = (m: OwnerMessage): string[] => [m.clipId, m.followUpFirstClipId, m.followUpSecondClipId].filter((x): x is string => !!x);
