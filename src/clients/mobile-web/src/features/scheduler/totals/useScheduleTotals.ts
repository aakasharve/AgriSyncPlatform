// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half) - the totals of several schedules for a screen: `loading` until each answer (or its lack) is known.
import { useEffect, useState } from 'react';
import { loadScheduleTotals, type TotalsLoad } from './scheduleTotalsStore';

export type TotalsState = 'loading' | TotalsLoad;

export function useScheduleTotals(ids: readonly string[], load: (id: string) => Promise<TotalsLoad> = id => loadScheduleTotals(id)): Record<string, TotalsState> {
    const [state, setState] = useState<Record<string, TotalsState>>({});
    const key = ids.join('|');
    useEffect(() => {
        let alive = true;
        for (const id of ids) {
            void Promise.resolve().then(() => load(id)).catch((): TotalsLoad => ({ ok: false, reason: 'failed' })).then(r => {
                if (alive) setState(s => ({ ...s, [id]: r }));
            });
        }
        return () => { alive = false; };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `load` is a stable seam; the ids decide
    return Object.fromEntries(ids.map(id => [id, state[id] ?? 'loading']));
}
