import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getSignals, type ComplianceSignalDto } from '../data/complianceClient';

type Filter = 'Open' | 'Acknowledged' | 'Resolved' | 'All';

interface UseComplianceSignalsResult {
    signals: ComplianceSignalDto[];
    isLoading: boolean;
    filter: Filter;
    setFilter: (f: Filter) => void;
    refresh: () => void;
}

export function useComplianceSignals(farmId: string | null): UseComplianceSignalsResult {
    const [allSignals, setAllSignals] = useState<ComplianceSignalDto[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState<Filter>('Open');
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick(t => t + 1), []);

    useEffect(() => {
        if (!farmId) {
            setAllSignals([]);
            setIsLoading(false);
            return;
        }

        let cancelled = false;

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
            } catch {
                // Server unavailable — cached data shown
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

    return { signals, isLoading, filter, setFilter, refresh };
}
