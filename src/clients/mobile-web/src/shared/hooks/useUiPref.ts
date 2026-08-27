/**
 * Sub-plan 04 Task 3 — useUiPref hook.
 *
 * Reads/writes UI prefs through Dexie's uiPrefs table so callers in pages/,
 * features/, and shared/ never touch localStorage directly. The architecture
 * gate (scripts/check-storage-discipline.mjs) enforces this rule.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

/**
 * @returns `[value, setValue, loaded]`.
 *
 * `loaded` turns true once the Dexie read has SETTLED — whether or not a row existed.
 * Until then `value` is still the fallback, which is indistinguishable from a genuine
 * stored fallback. Most callers can ignore the difference; a caller that must not act on
 * the fallback cannot (wave-4.1: the consent gate would flash on every cold start for a
 * farmer who has already accepted, because "not loaded yet" and "never accepted" both
 * read as `false`). Appended as a THIRD element so every existing
 * `const [v, set] = useUiPref(...)` is untouched.
 */
export function useUiPref<T>(key: string, fallback: T): readonly [T, (next: T) => void, boolean] {
    const [value, setValue] = useState<T>(fallback);
    const [loaded, setLoaded] = useState(false);

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
            } finally {
                // Settled either way: a missing row and a failed read are both answers,
                // and a caller waiting forever on `loaded` would be worse than either.
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [key]);

    const update = (next: T) => {
        setValue(next);
        void getDatabase().uiPrefs.put({ key, value: next }).catch(() => { /* swallow */ });
    };

    return [value, update, loaded] as const;
}
