/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S5) - the bundled village list, read from the app's own files
 * (`public/places/…`, no network in the APK: Capacitor serves them from the phone) only when the identity card needs it, ONCE per page visit (every
 * box shares the same promise), and dropped when the page closes so 44,930 rows do not stay in memory. A list that cannot be read is a plain
 * failure: the boxes then keep what he types ("यादीत नाही"), never a blank screen.
 */
import { PLACE_LIST_VERSION, parsePlaceList } from '../../domain/places/placeList';
import { buildPlaceIndex, type PlaceIndex } from '../../domain/places/placeSearch';
import { buildMarathiWordIndex, wordPairsOfPlaces, type MarathiWordIndex } from '../../domain/names/englishToMarathi';

export interface PlaceData {
    index: PlaceIndex;
    /** The checked Marathi word list (the list's Marathi village words) for the English-to-Marathi name suggestion. */
    words: MarathiWordIndex;
}

export type PlaceTextSource = () => Promise<{ tsv: string; areas: string }>;

/** The app's own two files, next to index.html (web origin or the APK's https://localhost). */
export const bundledPlaceSource: PlaceTextSource = async () => {
    const base = `${import.meta.env.BASE_URL ?? '/'}places/${PLACE_LIST_VERSION}`;
    const [tsv, areas] = await Promise.all([`${base}.tsv`, `${base}-areas.json`].map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`place list file ${response.status}`);
        return response.text();
    }));
    return { tsv, areas };
};

let current: Promise<PlaceData> | null = null;

/** The list for this page visit (read and indexed the first time it is asked for). */
export function loadPlaceData(source: PlaceTextSource = bundledPlaceSource): Promise<PlaceData> {
    if (current) return current;
    const loading = (async () => {
        const { tsv, areas } = await source();
        const list = parsePlaceList(tsv, areas);
        const places = list.villages.filter(v => v.nameMr !== null).map(v => ({ mr: v.nameMr as string, en: v.nameEn }));
        return { index: buildPlaceIndex(list), words: buildMarathiWordIndex(wordPairsOfPlaces(places).map(p => p.mr)) };
    })();
    current = loading;
    // A failed read is not kept: a later box may try again.
    loading.catch(() => { if (current === loading) current = null; });
    return loading;
}

/** The page closed: let the list go. */
export function releasePlaceData(): void {
    current = null;
}
