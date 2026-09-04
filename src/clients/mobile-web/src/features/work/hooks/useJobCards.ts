/**
 * useJobCards — Dexie-first, then server sync.
 * CEI Phase 4 §4.8 Work Trust Ledger
 *
 * @module features/work/hooks/useJobCards
 */

import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { JobCard } from '../../../domain/work/JobCard';
import type { DexieJobCard } from '../../../infrastructure/storage/DexieDatabase';
import {
    createJobCard,
    assignJobCard,
    startJobCard,
    completeJobCard,
    settleJobCard,
    cancelJobCard,
    getFarmJobCards,
    type CreateJobCardRequest,
    type AssignWorkerRequest,
    type CompleteJobCardRequest,
    type SettleJobCardRequest,
    type CancelJobCardRequest,
} from '../data/jobCardsClient';

interface UseJobCardsOptions {
    farmId: string | null;
    /** If provided, only cards with this status are returned */
    statusFilter?: string;
}

interface UseJobCardsResult {
    jobCards: JobCard[];
    isLoading: boolean;
    /**
     * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — true
     * when the LAST server read failed, so the screen knows it could not find
     * out what is true. `jobCards` still carries whatever Dexie had cached
     * (those rows really do exist, and blanking them would be its own
     * falsehood) — what this flag buys is the right to WITHHOLD the claim
     * "कोणते काम कार्ड नाही".
     *
     * NOT "the list is empty". A server that answers 200 with no cards has
     * given a real answer and that sentence is TRUE; this stays `false` there.
     * Keying the suppression on emptiness instead of on failure would swap one
     * lie for another.
     */
    loadFailed: boolean;
    createJobCard: (req: CreateJobCardRequest) => Promise<JobCard>;
    assignJobCard: (id: string, req: AssignWorkerRequest) => Promise<JobCard>;
    startJobCard: (id: string) => Promise<JobCard>;
    completeJobCard: (id: string, req: CompleteJobCardRequest) => Promise<JobCard>;
    settleJobCard: (id: string, req: SettleJobCardRequest) => Promise<JobCard>;
    cancelJobCard: (id: string, req: CancelJobCardRequest) => Promise<JobCard>;
    refresh: () => void;
}

export function useJobCards({ farmId, statusFilter }: UseJobCardsOptions): UseJobCardsResult {
    const [jobCards, setJobCards] = useState<JobCard[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick(t => t + 1), []);

    useEffect(() => {
        if (!farmId) {
            // No farm to read for — nothing was asked of the server, so there
            // is no failure to report either.
            setJobCards([]);
            setIsLoading(false);
            setLoadFailed(false);
            return;
        }

        let cancelled = false;
        // A fresh attempt starts from "we have not failed", so a retry that
        // succeeds clears the banner.
        setLoadFailed(false);

        const loadCached = async () => {
            const db = getDatabase();
            const query = db.jobCards.where('farmId').equals(farmId);
            const all = await query.toArray();
            const filtered = statusFilter
                ? all.filter(c => c.status === statusFilter)
                : all;
            if (!cancelled) {
                setJobCards(filtered as unknown as JobCard[]);
                setIsLoading(false);
            }
        };

        const loadFromServer = async () => {
            try {
                const fresh = await getFarmJobCards(farmId, statusFilter);
                if (cancelled) return;
                const db = getDatabase();
                await db.jobCards.bulkPut(fresh as unknown as DexieJobCard[]);
                if (!cancelled) {
                    setJobCards(fresh);
                    setLoadFailed(false);
                }
            } catch {
                // Server unavailable — cached data stays on screen (it is real),
                // but the failure is no longer silent: Task 8 needs the screen
                // to tell "we could not find out" apart from "there is
                // nothing". Reachable at all only because the client now
                // THROWS on a non-OK response instead of returning `[]`.
                if (!cancelled) setLoadFailed(true);
            }
        };

        loadCached().then(() => loadFromServer());

        return () => { cancelled = true; };
    }, [farmId, statusFilter, tick]);

    // -------------------------------------------------------------------------
    // Mutators — write to Dexie first, then sync server, then refresh
    // -------------------------------------------------------------------------

    const upsertLocal = useCallback(async (card: JobCard) => {
        const db = getDatabase();
        await db.jobCards.put(card as unknown as DexieJobCard);
        setJobCards(prev => {
            const idx = prev.findIndex(c => c.id === card.id);
            if (idx === -1) return [card, ...prev];
            const next = [...prev];
            next[idx] = card;
            return next;
        });
        return card;
    }, []);

    const doCreate = useCallback(async (req: CreateJobCardRequest) => {
        const card = await createJobCard(req);
        return upsertLocal(card);
    }, [upsertLocal]);

    const doAssign = useCallback(async (id: string, req: AssignWorkerRequest) => {
        const card = await assignJobCard(id, req);
        return upsertLocal(card);
    }, [upsertLocal]);

    const doStart = useCallback(async (id: string) => {
        const card = await startJobCard(id);
        return upsertLocal(card);
    }, [upsertLocal]);

    const doComplete = useCallback(async (id: string, req: CompleteJobCardRequest) => {
        const card = await completeJobCard(id, req);
        return upsertLocal(card);
    }, [upsertLocal]);

    const doSettle = useCallback(async (id: string, req: SettleJobCardRequest) => {
        const card = await settleJobCard(id, req);
        return upsertLocal(card);
    }, [upsertLocal]);

    const doCancel = useCallback(async (id: string, req: CancelJobCardRequest) => {
        const card = await cancelJobCard(id, req);
        return upsertLocal(card);
    }, [upsertLocal]);

    return {
        jobCards,
        isLoading,
        loadFailed,
        createJobCard: doCreate,
        assignJobCard: doAssign,
        startJobCard: doStart,
        completeJobCard: doComplete,
        settleJobCard: doSettle,
        cancelJobCard: doCancel,
        refresh,
    };
}
