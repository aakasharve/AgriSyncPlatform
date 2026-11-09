/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2, D-79) - the farm's tasks and reminders as this phone knows
 * them (`getLocalPlannedWork`: what the server let THIS person see, plus his unanswered changes), and the steps the server parked.
 * Read when the farm changes, when a pull finished (`agrisync:sync-reconciled`), when the net comes back, and when the caller asks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocalPlannedWork, type LocalPlannedWork } from './plannedWorkStore';
import { getParkedPlannedWork, type ParkedStep } from './plannedWorkParked';

export interface PlannedWorkState {
    items: LocalPlannedWork[];
    parked: Map<string, ParkedStep>;
    /** False until the first read has answered. */
    loaded: boolean;
    reload: () => Promise<void>;
}

const EMPTY_PARKED = new Map<string, ParkedStep>();

export function usePlannedWork(farmId: string | null | undefined): PlannedWorkState {
    const [items, setItems] = useState<LocalPlannedWork[]>([]);
    const [parked, setParked] = useState<Map<string, ParkedStep>>(EMPTY_PARKED);
    const [loaded, setLoaded] = useState(false);
    const alive = useRef(true);
    const latest = useRef(0);

    const reload = useCallback(async () => {
        const mine = ++latest.current;
        if (!farmId) {
            setItems([]); setParked(EMPTY_PARKED); setLoaded(true);
            return;
        }
        try {
            const [next, nextParked] = await Promise.all([getLocalPlannedWork(farmId), getParkedPlannedWork(farmId)]);
            if (alive.current && mine === latest.current) { setItems(next); setParked(nextParked); setLoaded(true); }
        } catch {
            if (alive.current && mine === latest.current) setLoaded(true);
        }
    }, [farmId]);

    useEffect(() => {
        alive.current = true;
        void reload();
        const again = () => { void reload(); };
        window.addEventListener('agrisync:sync-reconciled', again);
        window.addEventListener('online', again);
        // Lane L8c-4: a spoken reminder was mirrored from a log he just saved, or the one-time upload queued the old to-dos.
        window.addEventListener('agrisync:planned-work-changed', again);
        return () => {
            alive.current = false;
            window.removeEventListener('agrisync:sync-reconciled', again);
            window.removeEventListener('online', again);
            window.removeEventListener('agrisync:planned-work-changed', again);
        };
    }, [reload]);

    return { items, parked, loaded, reload };
}
