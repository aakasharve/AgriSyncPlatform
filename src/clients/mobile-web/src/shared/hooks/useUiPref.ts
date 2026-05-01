/**
 * Sub-plan 04 Task 3 — useUiPref hook.
 *
 * Reads/writes UI prefs through Dexie's uiPrefs table so callers in pages/,
 * features/, and shared/ never touch localStorage directly. The architecture
 * gate (scripts/check-storage-discipline.mjs) enforces this rule.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

export function useUiPref<T>(key: string, fallback: T): readonly [T, (next: T) => void] {
    const [value, setValue] = useState<T>(fallback);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const row = await getDatabase().uiPrefs.get(key);
                if (!cancelled && row) {
                    setValue(row.value as T);
                }
            } catch {
                // Dexie not yet open or migration in progress — keep fallback.
            }
        })();
        return () => { cancelled = true; };
    }, [key]);

    const update = (next: T) => {
        setValue(next);
        void getDatabase().uiPrefs.put({ key, value: next }).catch(() => { /* swallow */ });
    };

    return [value, update] as const;
}
