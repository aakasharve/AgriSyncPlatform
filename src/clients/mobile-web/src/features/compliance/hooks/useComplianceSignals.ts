import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getSignals, type ComplianceSignalDto } from '../data/complianceClient';

type Filter = 'Open' | 'Acknowledged' | 'Resolved' | 'All';

interface UseComplianceSignalsResult {
    signals: ComplianceSignalDto[];
    isLoading: boolean;
    /**
     * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — true
     * when the LAST server read failed. Cached signals stay in `signals`
     * (they are real); what this buys is the right to WITHHOLD "कोणत्याही
     * चेतावण्या नाहीत" — a reassurance, not just a count.
     *
     * NOT "the list is empty": a 200 with no signals is a real answer and that
     * sentence is TRUE, so this stays `false` there.
     */
    loadFailed: boolean;
    filter: Filter;
    setFilter: (f: Filter) => void;
    refresh: () => void;
}

export function useComplianceSignals(farmId: string | null): UseComplianceSignalsResult {
    const [allSignals, setAllSignals] = useState<ComplianceSignalDto[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [filter, setFilter] = useState<Filter>('Open');
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick(t => t + 1), []);

    useEffect(() => {
        if (!farmId) {
            // Nothing was asked of the server, so there is no failure either.
            setAllSignals([]);
            setIsLoading(false);
            setLoadFailed(false);
            return;
        }

        let cancelled = false;
        // A fresh attempt starts from "we have not failed".
        setLoadFailed(false);

        const loadCached = async () => {
            const db = getDatabase();
            const cached = await db.complianceSignals
                .where('farmId').equals(farmId)
                .toArray();
            if (!cancelled) {
                setAllSignals(cached as unknown as ComplianceSignalDto[]);
                setIsLoading(false);
            }
        };

        const loadFromServer = async () => {
            try {
                const fresh = await getSignals(farmId, { includeResolved: true, includeAcknowledged: true });
                if (cancelled) return;

                const db = getDatabase();
                await db.complianceSignals.bulkPut(fresh as unknown as Parameters<typeof db.complianceSignals.bulkPut>[0]);
                setAllSignals(fresh);
                setLoadFailed(false);
            } catch {
                // Server unavailable — cached data stays shown (it is real),
                // but the failure is no longer silent. Reachable at all only
                // because `getSignals` now THROWS on a non-OK response
                // instead of returning `[]` (Task 8).
                if (!cancelled) setLoadFailed(true);
            }
        };

        loadCached().then(() => loadFromServer());

        return () => { cancelled = true; };
    }, [farmId, tick]);

    const signals = allSignals.filter(s => {
        if (filter === 'Open') return s.isOpen && !s.acknowledgedAtUtc && !s.resolvedAtUtc;
        if (filter === 'Acknowledged') return Boolean(s.acknowledgedAtUtc) && !s.resolvedAtUtc;
        if (filter === 'Resolved') return Boolean(s.resolvedAtUtc);
        return true;
    });

    return { signals, isLoading, loadFailed, filter, setFilter, refresh };
}
