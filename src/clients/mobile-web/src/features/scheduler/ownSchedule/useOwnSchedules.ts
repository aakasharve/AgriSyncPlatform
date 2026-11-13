/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 4; founder D-136 "library by the person") - what the maker and the library read:
 *   - `useOwnSchedules` - the person's own schedules, chained, from the SAME raw rows the pull keeps (Dexie `referenceData` `scheduleTemplates`); the
 *     server decides who sees which (every farm of one owner lists them), the phone just lists the pull;
 *   - `usePendingOwnSchedules` - the saves still on this phone (queued, or refused and parked), so a schedule made with no net is not invisible and a
 *     refusal is never silent (P10). Read live from the outbox; nothing is stored here.
 * Names: a person's name comes from the people the seat may see (`farmerProfile.operators`, id = user id); none known -> none shown, never an id.
 */
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { useScheduleTemplates } from '../../../app/hooks/useReferenceData';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { isEntitlementHeldRejection } from '../../../infrastructure/sync/RejectionPolicy';
import { MAX_AUTO_RETRY_COUNT } from '../../../infrastructure/sync/retryCap';
import { findBlockingSaves } from './ownScheduleCommands';
import { buildOwnChains, parseOwnVersions, parseScheduleBody, type OwnChain, type OwnVersion, type ScheduleBody } from './ownScheduleModel';
import { scheduleCropCode } from '../../../infrastructure/reference/TemplateCatalog';

export interface OwnSchedules {
    chains: OwnChain[];
    /** version row id -> its chain */
    chainOfVersion: ReadonlyMap<string, OwnChain>;
    rows: readonly unknown[];
}

export function useOwnSchedules(): OwnSchedules {
    const raw = useScheduleTemplates();
    return useMemo(() => {
        const rows: readonly unknown[] = Array.isArray(raw) ? raw : [];
        const chains = buildOwnChains(parseOwnVersions(rows));
        const chainOfVersion = new Map<string, OwnChain>();
        chains.forEach(chain => chain.versions.forEach((v: OwnVersion) => chainOfVersion.set(v.id, chain)));
        return { chains, chainOfVersion, rows };
    }, [raw]);
}

/**
 * The schedule ShramSafal has CHECKED for a crop, the one "start from a checked schedule" copies: an outside row with stored days and a Checked check,
 * the Institution one first (the app's own default rule, `followableDefault.ts`), else the first. null = none ("या पिकासाठी अजून तपासलेलं शेड्यूल नाही").
 */
export function checkedSourceFor(rows: readonly unknown[], cropName: string): (ScheduleBody & { id: string; cropType: string }) | null {
    const code = scheduleCropCode(cropName);
    const candidates = rows.filter((row): row is Record<string, unknown> => {
        if (!row || typeof row !== 'object') return false;
        const r = row as Record<string, unknown>;
        const check = r.check as { state?: unknown } | null | undefined;
        const outside = (!r.scope || r.scope === 'Public') && !r.ownerUserId;
        return outside && r.hasStoredDays === true && check?.state === 'Checked' && typeof r.cropType === 'string' && scheduleCropCode(r.cropType) === code;
    });
    if (candidates.length === 0) return null;
    const pick = candidates.find(r => r.ownerType === 'INSTITUTION') ?? candidates[0];
    return parseScheduleBody(pick);
}

/**
 * What the phone can truthfully say about a save that is not on the server yet (fix round 1, P002):
 *   - `waiting` - the worker will still send it by itself (queued, sending, or failed BELOW the retry cap);
 *   - `held`    - the farm's plan refused new saves; the worker re-asks on a slow timer and it goes by itself once allowed;
 *   - `stuck`   - failed at the cap: the worker no longer sends it; only the sync drawer's retry does;
 *   - `refused` - the server refused it for good (parked): its words, and the conflict page.
 */
export type PendingKind = 'waiting' | 'held' | 'stuck' | 'refused';

export interface PendingOwnSchedule {
    clientRequestId: string;
    mutation: 'create' | 'clone' | 'edit';
    name: string | null;
    status: 'PENDING' | 'SENDING' | 'FAILED' | 'REJECTED_USER_REVIEW';
    kind: PendingKind;
    /** The server's code (a parked row), or the code found in the last error (a stuck row), when there is one. */
    errorCode: string | null;
    lastError: string | null;
}

/** Read only from the row's own facts; the cap is the one the queue uses (`retryCap.ts`). */
export function pendingKindOf(row: { status: string; retryCount?: number; errorCode?: string }): PendingKind {
    if (row.status === 'REJECTED_USER_REVIEW') return 'refused';
    if (row.status === 'FAILED') {
        if (isEntitlementHeldRejection({ errorCode: row.errorCode })) return 'held';
        if ((row.retryCount ?? 0) >= MAX_AUTO_RETRY_COUNT) return 'stuck';
    }
    return 'waiting';
}

const OWN_TYPES: ReadonlySet<string> = new Set([SyncMutationName.ScheduleCreate, SyncMutationName.ScheduleClone, SyncMutationName.ScheduleEdit]);

export function usePendingOwnSchedules(): PendingOwnSchedule[] {
    const [rows, setRows] = useState<PendingOwnSchedule[]>([]);
    useEffect(() => {
        let alive = true;
        let unsubscribe = () => {};
        try {
            const sub = liveQuery(async () => (await getDatabase().mutationQueue.toArray())).subscribe({
                next: all => {
                    if (!alive) return;
                    const open = all
                        .filter(r => OWN_TYPES.has(r.mutationType) && (r.status === 'PENDING' || r.status === 'SENDING' || r.status === 'FAILED' || r.status === 'REJECTED_USER_REVIEW'))
                        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
                    // An edit that depends on a create / copy listed beside it (the schedule it writes the stages of) is not a second card: the parent's
                    // card says what happened (P003). An edit whose parent is not listed (applied, or from the pull) stands on its own.
                    const produced = new Set(open.map(r => {
                        const p = (r.payload ?? {}) as Record<string, unknown>;
                        return r.mutationType === SyncMutationName.ScheduleCreate ? p.scheduleTemplateId : p.newScheduleTemplateId;
                    }).filter((v): v is string => typeof v === 'string'));
                    setRows(open
                        .filter(r => {
                            const p = (r.payload ?? {}) as Record<string, unknown>;
                            return !(r.mutationType === SyncMutationName.ScheduleEdit && typeof p.scheduleTemplateId === 'string' && produced.has(p.scheduleTemplateId)
                                && open.some(o => o !== r && ((o.payload ?? {}) as Record<string, unknown>)[o.mutationType === SyncMutationName.ScheduleCreate ? 'scheduleTemplateId' : 'newScheduleTemplateId'] === p.scheduleTemplateId));
                        })
                        .map(r => {
                            const payload = (r.payload ?? {}) as Record<string, unknown>;
                            const name = typeof payload.name === 'string' ? payload.name : typeof payload.newName === 'string' ? payload.newName : null;
                            return {
                                clientRequestId: r.clientRequestId,
                                mutation: r.mutationType === SyncMutationName.ScheduleCreate ? 'create' : r.mutationType === SyncMutationName.ScheduleClone ? 'clone' : 'edit',
                                name,
                                status: r.status as PendingOwnSchedule['status'],
                                kind: pendingKindOf(r),
                                errorCode: r.errorCode ?? null,
                                lastError: r.lastError ?? null,
                            };
                        }));
                },
                error: () => { if (alive) setRows([]); },
            });
            unsubscribe = () => sub.unsubscribe();
        } catch {
            setRows([]);
        }
        return () => { alive = false; unsubscribe(); };
    }, []);
    return rows;
}

/**
 * spec: plr-d10 lane SCH-OWN-b fix round 1 (P001) - is a further change of this schedule blocked right now (an earlier one of his is still unsynced)?
 * Read live from the outbox. `false` until read - the guard in `saveOwnSchedule` is the one that refuses; this only draws the words.
 */
export function useChangeBlocked(sourceId: string | null, knownVersionIds: readonly string[]): boolean {
    const [blocked, setBlocked] = useState(false);
    const key = `${sourceId ?? ''}|${knownVersionIds.join(',')}`;
    useEffect(() => {
        if (!sourceId) { setBlocked(false); return undefined; }
        let alive = true;
        let unsubscribe = () => {};
        try {
            const sub = liveQuery(() => findBlockingSaves(sourceId, knownVersionIds)).subscribe({
                next: ids => { if (alive) setBlocked(ids.length > 0); },
                error: () => { if (alive) setBlocked(false); },
            });
            unsubscribe = () => sub.unsubscribe();
        } catch {
            setBlocked(false);
        }
        return () => { alive = false; unsubscribe(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` carries the ids
    }, [key]);
    return blocked;
}

/**
 * spec: plr-d10 lane SCH-OWN-b fix round 1 (P006) - the owner of the open farm, as the pull's farm row says (`ownerUserId`); null while the phone does
 * not know it. A person's own schedule is followable only on plots of a farm his owner owns (the server's rule: another owner's is "not found").
 */
export function useFarmOwnerUserId(farmId: string | null | undefined): string | null {
    const [owner, setOwner] = useState<string | null>(null);
    useEffect(() => {
        if (!farmId) { setOwner(null); return undefined; }
        let alive = true;
        let unsubscribe = () => {};
        try {
            const sub = liveQuery(() => getDatabase().farms.get(farmId)).subscribe({
                next: record => {
                    const id = (record?.payload as { ownerUserId?: unknown } | null | undefined)?.ownerUserId;
                    if (alive) setOwner(typeof id === 'string' && id.trim() ? id.trim() : null);
                },
                error: () => { if (alive) setOwner(null); },
            });
            unsubscribe = () => sub.unsubscribe();
        } catch {
            setOwner(null);
        }
        return () => { alive = false; unsubscribe(); };
    }, [farmId]);
    return owner;
}
