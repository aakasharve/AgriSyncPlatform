import { useState, useEffect, useCallback } from 'react';
import { getDatabase, AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';

interface UseAttentionBoardResult {
    cards: AttentionCardCacheRecord[];
    asOf: string | null;
    isLoading: boolean;
    refresh: () => void;
}

export function useAttentionBoard(): UseAttentionBoardResult {
    const [cards, setCards] = useState<AttentionCardCacheRecord[]>([]);
    const [asOf, setAsOf] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const db = getDatabase();
            const all = await db.attentionCards.orderBy('rank').toArray();
            setCards(all);
            const latest = all.reduce<string | null>((max, c) => {
                if (!max) return c.computedAtUtc;
                return c.computedAtUtc > max ? c.computedAtUtc : max;
            }, null);
            setAsOf(latest);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    return { cards, asOf, isLoading, refresh: load };
}
