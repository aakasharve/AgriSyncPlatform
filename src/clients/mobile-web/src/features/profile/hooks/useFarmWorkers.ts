/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useFarmWorkers - the farm's NAMED WORKERS (field operators: a name on the farm, no login),
 * held in one place so the Team page cannot invent its own.
 *
 * A named worker is NOT a linked app user (a membership: invite / QR) and NOT a subscription.
 * Adding or removing one creates or removes nothing but the work identity itself.
 *
 * ── SERVER TRUTH, NO OPTIMISTIC ROW ──────────────────────────────────────────
 * `add` and `remove` change the list only with the row the SERVER returned. A failure leaves the
 * list exactly as it was and reports why. There is no field-operator mutation in the sync outbox,
 * so these writes are ONLINE-ONLY: offline is reported as offline, never queued, never presented
 * as "remembered on phone", never claimed saved.
 *
 * ── IDEMPOTENT ADD ───────────────────────────────────────────────────────────
 * The caller supplies the id of the person being added (one per open form, reused across retries).
 * The server uses it as the operator id, so a retry after a lost response returns the same person.
 *
 * @module features/profile/hooks/useFarmWorkers
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    createFieldOperator,
    deactivateFieldOperator,
    fetchFieldOperators,
    type FieldOperator,
} from '../../labour/data/fieldOperatorClient';
import { writeCachedRoster } from '../../labour/data/fieldOperatorRosterCache';

export type WorkerActionFailure = 'offline' | 'refused' | 'failed';

export type WorkerActionResult =
    | { ok: true; worker: FieldOperator }
    | { ok: false; reason: WorkerActionFailure };

/** 'offline' = the request never reached a server; 'refused' = the server said no (403). */
export function classifyWorkerFailure(error: unknown): WorkerActionFailure {
    const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
    if (status === 403) return 'refused';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    const noResponse = typeof error === 'object' && error !== null && (error as { response?: unknown }).response === undefined
        && ((error as { request?: unknown }).request !== undefined || (error as { code?: unknown }).code === 'ERR_NETWORK');
    return noResponse ? 'offline' : 'failed';
}

export interface UseFarmWorkersResult {
    /** `null` until the first read resolves, or when it failed: NOT an empty team. */
    workers: FieldOperator[] | null;
    loading: boolean;
    /** The read failed; the list (if any) is not current and the caller must say so. */
    loadFailed: boolean;
    /** The worker whose Remove is in flight. */
    removingId: string | null;
    adding: boolean;
    reload: () => Promise<void>;
    add: (displayName: string, fullName: string | undefined, clientId: string) => Promise<WorkerActionResult>;
    remove: (id: string) => Promise<WorkerActionResult>;
}

export function useFarmWorkers(farmId: string | null | undefined): UseFarmWorkersResult {
    const [workers, setWorkers] = useState<FieldOperator[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const addingRef = useRef(false);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const farmRef = useRef(farmId);
    farmRef.current = farmId;

    const load = useCallback(async () => {
        if (!farmId) {
            setWorkers(null);
            setLoadFailed(false);
            return;
        }
        setLoading(true);
        setLoadFailed(false);
        try {
            const fresh = await fetchFieldOperators(farmId);
            if (!mountedRef.current || farmRef.current !== farmId) return;
            setWorkers(fresh);
            writeCachedRoster(farmId, fresh);
        } catch {
            if (!mountedRef.current || farmRef.current !== farmId) return;
            // Not an empty team: unknown. The page says the list did not load.
            setWorkers(null);
            setLoadFailed(true);
        } finally {
            if (mountedRef.current && farmRef.current === farmId) setLoading(false);
        }
    }, [farmId]);

    useEffect(() => { void load(); }, [load]);

    const add = useCallback(async (displayName: string, fullName: string | undefined, clientId: string): Promise<WorkerActionResult> => {
        const name = displayName.trim();
        if (!farmId || !name || addingRef.current) return { ok: false, reason: 'failed' };
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
        addingRef.current = true;
        setAdding(true);
        try {
            const created = await createFieldOperator(farmId, name, fullName, clientId);
            if (mountedRef.current && farmRef.current === farmId) {
                setWorkers((prev) => {
                    const base = (prev ?? []).filter((w) => w.id !== created.id);
                    const next = [...base, created];
                    writeCachedRoster(farmId, next);
                    return next;
                });
            }
            return { ok: true, worker: created };
        } catch (err) {
            return { ok: false, reason: classifyWorkerFailure(err) };
        } finally {
            addingRef.current = false;
            if (mountedRef.current) setAdding(false);
        }
    }, [farmId]);

    const remove = useCallback(async (id: string): Promise<WorkerActionResult> => {
        if (!farmId) return { ok: false, reason: 'failed' };
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
        setRemovingId(id);
        try {
            const retired = await deactivateFieldOperator(farmId, id);
            if (mountedRef.current && farmRef.current === farmId) {
                setWorkers((prev) => {
                    // Keep the row (inactive) rather than dropping it: the cached roster is what the
                    // attendance pickers filter on, and history still needs his name.
                    const next = (prev ?? []).map((w) => (w.id === id ? { ...w, isActive: retired.isActive } : w));
                    writeCachedRoster(farmId, next);
                    return next;
                });
            }
            return { ok: true, worker: retired };
        } catch (err) {
            return { ok: false, reason: classifyWorkerFailure(err) };
        } finally {
            if (mountedRef.current) setRemovingId(null);
        }
    }, [farmId]);

    return { workers, loading, loadFailed, removingId, adding, reload: load, add, remove };
}
