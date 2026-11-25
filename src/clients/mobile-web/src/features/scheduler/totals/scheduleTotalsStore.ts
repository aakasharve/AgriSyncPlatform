// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half; P4 no number without evidence, P10 offline) - the follow totals of a schedule, exactly as the server sent them.
//
// `GET /shramsafal/schedule-templates/{id}/totals` carries counts, task keys and work names only. A number is null when fewer than five farmers stand behind it; a sample and an own
// schedule carry no number at all. The phone NEVER fills a null, and never counts anything itself. The last answer is kept in `referenceData` under `scheduleTotals:<schedule id>`
// (a disposable server cache like `ownerMessages`; no new Dexie store, no version bump) so it shows with no signal, and the screen says in words that it is the last one seen with signal.
import { apiFetch as realApiFetch } from '../../../infrastructure/api/apiFetch';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

export type TotalsKind = 'totals' | 'sample' | 'own';

export interface ScheduleTotalsWork { taskKey: string; name: string; farmers: number }

export interface ScheduleTotals {
    scheduleId: string;
    chainId: string | null;
    kind: TotalsKind;
    minimumFarmers: number;
    following: number | null;
    having: number | null;
    worksTaken: number | null;
    worksInSchedule: number | null;
    worksTakenPercent: number | null;
    works: ScheduleTotalsWork[];
    doneJobs: number | null;
    heard: number | null;
    checkedVersionId: string | null;
}

export type TotalsLoad =
    | { ok: true; totals: ScheduleTotals; source: 'network' | 'phone' }
    | { ok: false; reason: 'offline-no-copy' | 'not-found' | 'failed' };

export type TotalsFetch = (path: string, init: RequestInit) => Promise<Response>;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyOf = (id: string) => `scheduleTotals:${id}` as const;

const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** The answer as the phone may draw it, or null when it is not an answer. A number that is not a whole number is a null (never a guess); a sample / own answer carries none. */
export function parseScheduleTotals(raw: unknown): ScheduleTotals | null {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Record<string, unknown>;
    const kind = d.kind;
    if (kind !== 'totals' && kind !== 'sample' && kind !== 'own') return null;
    const scheduleId = text(d.scheduleId);
    if (!scheduleId) return null;
    const base = { scheduleId, chainId: text(d.chainId), kind, minimumFarmers: whole(d.minimumFarmers) ?? 5 } as const;
    if (kind !== 'totals') {
        return { ...base, following: null, having: null, worksTaken: null, worksInSchedule: null, worksTakenPercent: null, works: [], doneJobs: null, heard: null, checkedVersionId: null };
    }
    const works: ScheduleTotalsWork[] = [];
    for (const w of Array.isArray(d.works) ? d.works : []) {
        const r = w as Record<string, unknown> | null;
        const farmers = whole(r?.farmers);
        const taskKey = text(r?.taskKey);
        const name = text(r?.name);
        if (taskKey && name && farmers !== null) works.push({ taskKey, name, farmers });
    }
    return {
        ...base,
        following: whole(d.following), having: whole(d.having), worksTaken: whole(d.worksTaken), worksInSchedule: whole(d.worksInSchedule), worksTakenPercent: whole(d.worksTakenPercent),
        works, doneJobs: whole(d.doneJobs), heard: whole(d.heard), checkedVersionId: text(d.checkedVersionId),
    };
}

async function readKept(id: string): Promise<ScheduleTotals | null> {
    try {
        const row = await getDatabase().referenceData.get(keyOf(id));
        return row ? parseScheduleTotals(row.data) : null;
    } catch {
        return null;
    }
}

async function keep(id: string, raw: unknown): Promise<void> {
    try {
        await getDatabase().referenceData.put({ key: keyOf(id), data: raw, versionHash: '', updatedAt: new Date().toISOString() });
    } catch {
        // A copy that cannot be kept is only a missed shortcut: the numbers are drawn from the answer in hand.
    }
}

/**
 * The totals of one schedule (any version id of it). With signal: the server's answer, kept on the phone. Without it, or when the request fails: the kept answer (`source: 'phone'`).
 * A schedule the server does not show this person (404/403) loses its kept numbers and is never drawn from an old copy.
 */
export async function loadScheduleTotals(scheduleId: string, send: TotalsFetch = realApiFetch): Promise<TotalsLoad> {
    if (!ID.test(scheduleId)) return { ok: false, reason: 'not-found' };
    const kept = await readKept(scheduleId);
    const fromPhone: TotalsLoad | null = kept ? { ok: true, totals: kept, source: 'phone' } : null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return fromPhone ?? { ok: false, reason: 'offline-no-copy' };

    let response: Response;
    try {
        response = await send(`/shramsafal/schedule-templates/${scheduleId}/totals`, { method: 'GET' });
    } catch {
        return fromPhone ?? { ok: false, reason: 'offline-no-copy' };
    }
    if (response.status === 404 || response.status === 403) {
        await getDatabase().referenceData.delete(keyOf(scheduleId)).catch(() => undefined);
        return { ok: false, reason: 'not-found' };
    }
    if (!response.ok) return fromPhone ?? { ok: false, reason: 'failed' };
    let raw: unknown;
    try { raw = await response.json(); } catch { raw = null; }
    const totals = parseScheduleTotals(raw);
    if (!totals) return fromPhone ?? { ok: false, reason: 'failed' };
    await keep(scheduleId, raw);
    return { ok: true, totals, source: 'network' };
}
