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
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick(t => t + 1), []);

    useEffect(() => {
        if (!farmId) {
            setJobCards([]);
            setIsLoading(false);
            return;
        }

        let cancelled = false;

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
                if (!cancelled) setJobCards(fresh);
            } catch {
                // Server unavailable — show cached data
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
        createJobCard: doCreate,
        assignJobCard: doAssign,
        startJobCard: doStart,
        completeJobCard: doComplete,
        settleJobCard: doSettle,
        cancelJobCard: doCancel,
        refresh,
    };
}
