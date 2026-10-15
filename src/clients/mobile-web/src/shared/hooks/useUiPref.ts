/**
 * Sub-plan 04 Task 3 — useUiPref hook.
 *
 * Reads/writes UI prefs through Dexie's uiPrefs table so callers in pages/,
 * features/, and shared/ never touch localStorage directly. The architecture
 * gate (scripts/check-storage-discipline.mjs) enforces this rule.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { onActiveDatabaseChanged } from '../../infrastructure/storage/activeDatabaseName';

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
export function useUiPref<T>(
    key: string,
    fallback: T,
    options?: { rereadOnDatabaseChange?: boolean },
): readonly [T, (next: T) => void, boolean] {
    const [value, setValue] = useState<T>(fallback);
    const [loaded, setLoaded] = useState(false);
    const reread = options?.rereadOnDatabaseChange === true;
    // Bumped when the active per-farmer database changes (login / logout). Only subscribed
    // when the caller opts in: a device-level decision (the consent gate) is stored in ONE
    // database but read while ANOTHER may be active, so a read taken before the switch is
    // not the answer after it.
    const [dbEpoch, setDbEpoch] = useState(0);

    useEffect(() => {
        if (!reread) return;
        return onActiveDatabaseChanged(() => {
            // Back to "don't know yet" in the same breath as the switch, so the caller
            // never acts on the previous database's answer (no flash of a wrong screen).
            setLoaded(false);
            setValue(fallback);
            setDbEpoch((n) => n + 1);
        });
        // fallback is a literal at the call sites that opt in
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reread]);

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
    }, [key, dbEpoch]);

    const update = (next: T) => {
        setValue(next);
        void getDatabase().uiPrefs.put({ key, value: next }).catch(() => { /* swallow */ });
    };

    return [value, update, loaded] as const;
}
