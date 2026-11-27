/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.2; CTO ruling Q3 A) - a record that holds a kind of work this person
 * may not record on its farm. In the ONE save path (`LogCommandServiceImpl.confirmAndSave`, before the Dexie write and the enqueue), the closed kinds
 * are taken out of the record, so the phone's copy is exactly what the server receives (P10) and the server never has to refuse the whole record:
 *   - the allowed parts are saved; his whole words (`fullTranscript`) and his clip stay with the record (P8: what he said is kept);
 *   - the record's local meta keeps `kindsNotSaved`, and the saved screen says "‹kind› नोंदवण्याची परवानगी नाही — मालकाला सांगा";
 *   - a recording with ONLY closed kinds writes no empty record: the save is refused before anything is written (`WorkKindsClosedError`, with
 *     words), and his clip stays in आवाज नोंदी (D-59).
 * Nothing is taken out when the phone does not know the limit (`null` = every kind): the server decides, and a refusal is parked with words.
 */
import type { DailyLog, LogMeta } from '../../types';
import { LIMITABLE_WORK_KINDS, allowedWorkKinds, closedKindsOf, type WorkKind } from '../../core/session/workKinds';
import { readAccessScopes } from '../../infrastructure/storage/accessScopeStore';
import { resolveLogFarmId } from '../logs/services/logSyncMutationService';
import { workKindWords } from './workKindWords';

/** The record's buckets: what he said that is work, a note or a reminder. */
const RECORD_BUCKETS = [...LIMITABLE_WORK_KINDS, 'observations', 'plannedTasks'] as const;

/** A log's local meta with the kinds this phone took out (phone only, never on the wire; a pull merges meta and keeps it). */
type MetaWithKinds = LogMeta & { kindsNotSaved?: WorkKind[] };

/** Does this record still say anything: an item in any bucket, or the stoppage chip? */
export function saysAnything(record: Partial<Record<string, unknown>>): boolean {
    if (RECORD_BUCKETS.some(b => Array.isArray(record[b]) && (record[b] as unknown[]).length > 0)) return true;
    return !!record.disturbance && typeof record.disturbance === 'object';
}

/** The closed kinds of a record that holds NOTHING it may keep, or null (it holds something allowed, or nothing closed). */
export function onlyClosedKinds(record: Partial<Record<string, unknown>>, allowed: ReadonlySet<WorkKind> | null): WorkKind[] | null {
    const closed = closedKindsOf(record, allowed);
    if (closed.length === 0) return null;
    const rest: Record<string, unknown> = { ...record };
    for (const kind of closed) rest[kind] = [];
    return saysAnything(rest) ? null : closed;
}

/** The kinds this phone took out of a saved record (none = nothing taken out). */
export function kindsNotSavedOf(logs: readonly DailyLog[]): WorkKind[] {
    const found = new Set<string>(logs.flatMap(l => (l.meta as MetaWithKinds | undefined)?.kindsNotSaved ?? []));
    return LIMITABLE_WORK_KINDS.filter(k => found.has(k));
}

/** A save that held only kinds this person may not record: nothing was written. PROPOSED words, with English twins. */
export class WorkKindsClosedError extends Error {
    readonly kinds: readonly WorkKind[];

    constructor(kinds: readonly WorkKind[]) {
        super('This kind of work may not be recorded by this person; nothing was saved.');
        this.name = 'WorkKindsClosedError';
        this.kinds = kinds;
    }

    /** The words he reads, in his language. */
    messageIn(language: string | null | undefined): string {
        const w = workKindWords(language);
        return `${w.notAllowedLine(this.kinds)}. ${w.keptLine}`;
    }
}

type AllowedFor = (log: DailyLog) => Promise<ReadonlySet<WorkKind> | null>;

/**
 * The limit of the farm each log goes to (its plot's farm, the farm the server checks; else the farm it was saved under), or `null` when no
 * farm this phone knows limits him: then nothing more is read and the save is exactly as before (every seat today, P9 / P11).
 */
async function limitReader(): Promise<AllowedFor | null> {
    const stored = await readAccessScopes().catch(() => null);
    if (!stored || !stored.scopes.some(s => Array.isArray(s.workKinds))) return null;
    return async log => {
        const farmId = (await resolveLogFarmId(log).catch(() => null)) ?? log.meta?.farmId ?? null;
        return allowedWorkKinds(stored, farmId);
    };
}

/**
 * Takes the closed kinds out of each log, IN PLACE (every caller hands its own array on to the enqueue, like the other steps of
 * `confirmAndSave`). A log left saying nothing is dropped from the array; when every log would be left saying nothing, nothing is changed
 * on any of them and `WorkKindsClosedError` is thrown, before anything is written.
 */
export async function takeOutClosedKinds(logs: DailyLog[], given?: AllowedFor): Promise<void> {
    const allowedFor = given ?? await limitReader();
    if (!allowedFor) return;
    const plans = await Promise.all(logs.map(async log => ({ log, closed: closedKindsOf(log as unknown as Record<string, unknown>, await allowedFor(log)) })));
    const touched = plans.filter(p => p.closed.length > 0);
    if (touched.length === 0) return;
    const leftEmpty = (p: { log: DailyLog; closed: WorkKind[] }): boolean => {
        const rest: Record<string, unknown> = { ...(p.log as unknown as Record<string, unknown>) };
        for (const kind of p.closed) rest[kind] = [];
        return !saysAnything(rest);
    };
    const emptied = new Set(touched.filter(leftEmpty).map(p => p.log));
    if (emptied.size === logs.length) {
        throw new WorkKindsClosedError(LIMITABLE_WORK_KINDS.filter(k => touched.some(p => p.closed.includes(k))));
    }
    for (const { log, closed } of touched) {
        // New arrays, never a splice of the old ones: the parse he spoke (the draft) stays whole for any screen that still shows it.
        for (const kind of closed) (log as unknown as Record<string, unknown>)[kind] = [];
        const meta: MetaWithKinds = { ...(log.meta ?? { createdAtISO: `${log.date}T12:00:00` }), kindsNotSaved: closed };
        log.meta = meta;
    }
    for (let i = logs.length - 1; i >= 0; i -= 1) {
        if (emptied.has(logs[i])) logs.splice(i, 1);
    }
}
