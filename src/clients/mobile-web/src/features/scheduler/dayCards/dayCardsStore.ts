// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8; P10 offline, P11 old servers) - where the day-card detail comes from: this phone's copy first (Dexie
// `scheduleDayCards`, a DISPOSABLE cache), the server when there is signal. The server is the truth: a copy is replaced the moment a fetched detail carries another
// content hash, and a copy that cannot be read is dropped. Nothing here writes anything the farmer made.
import { apiFetch as realApiFetch } from '../../../infrastructure/api/apiFetch';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SCHEDULE_FORMAT } from '../../../infrastructure/api/resources/SyncResource';
import { parseDayCardsDetail, type DayCardsDetail } from './dayCardsTypes';

export type DayCardsFetch = (path: string, init: RequestInit) => Promise<Response>;

export type DayCardsLoad =
    | { ok: true; detail: DayCardsDetail; source: 'network' | 'phone'; stale: boolean }
    | { ok: false; reason: 'offline-no-copy' | 'not-found' | 'not-allowed' | 'failed' };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** This phone's copy of a schedule version's day cards, or null (no copy, or one that cannot be read: it is deleted). */
export async function readCachedDayCards(templateId: string): Promise<DayCardsDetail | null> {
    try {
        const row = await getDatabase().scheduleDayCards.get(templateId);
        if (!row) return null;
        const detail = parseDayCardsDetail(row.detail);
        if (!detail) {
            await getDatabase().scheduleDayCards.delete(templateId).catch(() => undefined);
            return null;
        }
        return detail;
    } catch {
        return null;
    }
}

async function keepCopy(templateId: string, raw: unknown, detail: DayCardsDetail): Promise<void> {
    try {
        await getDatabase().scheduleDayCards.put({ templateId, contentHash: detail.contentHash, fetchedAtUtc: new Date().toISOString(), detail: raw });
    } catch {
        // A copy that cannot be kept is only a missed shortcut: the cards are drawn from the answer in hand.
    }
}

/**
 * The detail of one schedule version. With signal: the server's answer, kept on the phone (replacing a copy whose hash differs). Without it (or when the request fails):
 * this phone's copy, flagged `stale` when it could not be checked against the server. A version the server does not know for this caller, or refuses, is never drawn
 * from an old copy: the copy is dropped (a schedule the person may no longer see is not kept readable).
 */
export async function loadDayCards(templateId: string, send: DayCardsFetch = realApiFetch): Promise<DayCardsLoad> {
    if (!ID.test(templateId)) return { ok: false, reason: 'not-found' };
    const copy = await readCachedDayCards(templateId);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) return copy ? { ok: true, detail: copy, source: 'phone', stale: true } : { ok: false, reason: 'offline-no-copy' };

    let response: Response;
    try {
        response = await send(`/shramsafal/reference/schedule-templates/${templateId}/day-cards?scheduleFormat=${SCHEDULE_FORMAT}`, { method: 'GET' });
    } catch {
        return copy ? { ok: true, detail: copy, source: 'phone', stale: true } : { ok: false, reason: 'offline-no-copy' };
    }

    if (response.status === 404 || response.status === 403) {
        await getDatabase().scheduleDayCards.delete(templateId).catch(() => undefined);
        return { ok: false, reason: response.status === 404 ? 'not-found' : 'not-allowed' };
    }
    if (!response.ok) return copy ? { ok: true, detail: copy, source: 'phone', stale: true } : { ok: false, reason: 'failed' };

    let raw: unknown;
    try { raw = await response.json(); } catch { raw = null; }
    const detail = parseDayCardsDetail(raw);
    if (!detail) return copy ? { ok: true, detail: copy, source: 'phone', stale: true } : { ok: false, reason: 'failed' };
    if (!copy || copy.contentHash !== detail.contentHash) await keepCopy(templateId, raw, detail);
    return { ok: true, detail, source: 'network', stale: false };
}
