/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18) — the app's ONE crop list: the founder's crop master
 * (310 crops, MHCR-0001…), stored in the app so it works offline. Pure: lookups, search and the visibility rule.
 *
 * Founder rule (2026-10-26): "in English only show English and in Marathi it must show Marathi strictly every
 * where" and "integrate all this list". A stored crop name is NEVER rewritten: it is READ through this list —
 * by its MHCR id where one is known, else by its name (any of the sheet's names, in either language). A name
 * the list does not know, or that two different crops share, is not read at all: the caller shows it as entered.
 */
import { CROP_MASTER_GROUPS, CROP_MASTER_ROWS } from './cropMasterData';
import type { CropMasterRow, CropVisibility } from './cropMaster.types';
import { romanizeMarathi, soundKey } from './romanizeMarathi';

export type { CropMasterRow, CropVisibility } from './cropMaster.types';

/**
 * PENDING D-25 — what each visibility level does when a farmer ADDS a crop. ONE config: change a level here and
 * every picker follows. The default is the one the decision page states:
 *   - the 43 "Core candidate" crops are picture tiles;
 *   - the 85 "Searchable" and the 83 "Review" crops are found by typing (or saying) any of their names;
 *   - the 99 "Hidden until MH verified" crops are not offered.
 * Crops already on a farm are always shown, whatever their level (they are the farm's own, never filtered).
 */
export type CropOffer = 'tile' | 'search' | 'off';
export const CROP_VISIBILITY_POLICY: Readonly<Record<CropVisibility, CropOffer>> = {
    core: 'tile',
    searchable: 'search',
    review: 'search',
    hidden: 'off',
};

/** "Rice (paddy)" → "rice paddy"; case, punctuation, spacing and Unicode form never decide a match. */
export const normName = (value: string | null | undefined): string =>
    (value ?? '').normalize('NFC').toLowerCase().replace(/[()[\]{}.,;:'"’‘“”/\\_-]+/g, ' ').replace(/\s+/g, ' ').trim();

const BY_ID = new Map<string, CropMasterRow>(CROP_MASTER_ROWS.map(r => [r.id, r]));
const CANONICAL = new Map<string, CropMasterRow[]>();
const ALTERNATE = new Map<string, CropMasterRow[]>();
const push = (index: Map<string, CropMasterRow[]>, name: string, row: CropMasterRow) => {
    const key = normName(name);
    if (!key) return;
    const list = index.get(key) ?? [];
    if (!list.includes(row)) list.push(row);
    index.set(key, list);
};
for (const row of CROP_MASTER_ROWS) {
    push(CANONICAL, row.en, row);
    push(CANONICAL, row.mr, row);
    row.altEn.forEach(n => push(ALTERNATE, n, row));
    row.altMr.forEach(n => push(ALTERNATE, n, row));
}

/**
 * The one crop several rows name together, when there is one: all of them are forms of the same base crop
 * ("मेथी" = Fenugreek and Fenugreek greens → Fenugreek). Otherwise none (two different crops share the name).
 */
function oneCropOf(rows: readonly CropMasterRow[] | undefined): CropMasterRow | undefined {
    if (!rows || rows.length === 0) return undefined;
    if (rows.length === 1) return rows[0];
    const base = rows[0].base;
    return rows.every(r => r.base === base) ? BY_ID.get(base) : undefined;
}

export const ALL_CROPS: readonly CropMasterRow[] = CROP_MASTER_ROWS;

export const cropById = (id: string | null | undefined): CropMasterRow | undefined => (id ? BY_ID.get(id.trim()) : undefined);

/** The crop a stored name means: a canonical name first, then an alternate one; undefined when unknown or shared. */
export function cropByName(name: string | null | undefined): CropMasterRow | undefined {
    const key = normName(name);
    if (!key) return undefined;
    const canonical = CANONICAL.get(key);
    if (canonical) return oneCropOf(canonical);
    return oneCropOf(ALTERNATE.get(key));
}

/** The crop a stored crop is: by its MHCR id where known, else by its name. */
export const resolveCrop = (ref: { masterId?: string | null; name?: string | null }): CropMasterRow | undefined =>
    cropById(ref.masterId) ?? cropByName(ref.name);

/** The crop's own name in this language — the sheet's canonical name ('' when the sheet has none in it). */
export const cropLabel = (row: CropMasterRow, language: string | null | undefined): string => (language === 'en' ? row.en : row.mr);

/** The crop's group name in this language. */
export const cropGroupLabel = (row: CropMasterRow, language: string | null | undefined): string => {
    const group = CROP_MASTER_GROUPS[row.group];
    return group ? (language === 'en' ? group.en : group.mr) : '';
};

/** What the add-crop picker does with this crop (a crop already on the farm is always shown). */
export const offerOf = (row: CropMasterRow, onFarm?: ReadonlySet<string>): CropOffer =>
    onFarm?.has(row.id) ? 'tile' : CROP_VISIBILITY_POLICY[row.vis];

/** The picture tiles of the add-crop picker: the policy's tile crops plus the farm's own, in the sheet's order. */
export const cropTiles = (onFarm?: ReadonlySet<string>): CropMasterRow[] => ALL_CROPS.filter(r => offerOf(r, onFarm) === 'tile');

const namesOf = (row: CropMasterRow): string[] => [row.en, row.mr, ...row.altEn, ...row.altMr].filter(Boolean);

/** The Marathi names of a crop as English letters (D-25): "ऊस" is found by "us". Built once per crop. */
const SOUNDS = new Map<string, string[]>();
const soundsOf = (row: CropMasterRow): string[] => {
    let list = SOUNDS.get(row.id);
    if (!list) { list = [row.mr, ...row.altMr].map(romanizeMarathi).filter(Boolean); SOUNDS.set(row.id, list); }
    return list;
};

const scoreName = (name: string, q: string): number =>
    name === q ? 4 : name.startsWith(q) ? 3 : name.split(' ').some(w => w.startsWith(q)) ? 2 : name.includes(q) ? 1 : 0;

/** Letters as a farmer sees them (aksharas): "द्रा" is one, though it is four code points. */
const lettersOf = (text: string): number => {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (t: string) => Iterable<unknown> } }).Segmenter;
    return Seg ? Array.from(new Seg('mr', { granularity: 'grapheme' }).segment(text)).length : Array.from(text).length;
};

/** A search of 1-2 letters shows at most this many crops (my call: enough to see the crop, not a flood). */
export const SHORT_SEARCH_CAP = 20;

/**
 * The crops a typed (or said) word finds - by English, Marathi or any alternate name, and by a Marathi name typed in
 * English letters ("us" = ऊस) - best first: a whole name, then a name starting with it, then a word of a name starting
 * with it, then a name containing it; the sheet's order inside each group. One or two letters are enough; such a short
 * search shows at most SHORT_SEARCH_CAP crops. A crop the policy hides is never found (unless it is already on the farm).
 */
export function searchCrops(query: string, opts: { onFarm?: ReadonlySet<string>; limit?: number } = {}): CropMasterRow[] {
    // search-only key: zero-width joiners / non-joiners a phone keyboard may add inside a word never decide a match
    // (normName itself is read app-wide and stays untouched)
    const q = normName(query.replace(/[\u200B-\u200D\u2060\uFEFF]/g, ''));
    if (!q) return [];
    // sound key: English letters directly; a Devanagari query by its own sound-alike (उस = us meets ऊस = us)
    const sound = /^[a-z ]+$/.test(q) ? soundKey(q) : /[ऀ-ॿ]/.test(q) ? romanizeMarathi(q) : '';
    const scored: Array<{ row: CropMasterRow; score: number; at: number }> = [];
    ALL_CROPS.forEach((row, at) => {
        if (offerOf(row, opts.onFarm) === 'off') return;
        let best = 0;
        for (const raw of namesOf(row)) best = Math.max(best, scoreName(normName(raw), q));
        // a Marathi name by its sound (English letters, or a Devanagari query's own sound-alike): a sound-only match counts
        // at most 2.5, so it never outranks a native starts-with / word-start match; when a native match exists, the best
        // of the two counts
        if (sound) {
            const heard = Math.max(0, ...soundsOf(row).map(h => scoreName(h, sound)));
            if (heard > 0) best = best === 0 ? Math.min(heard - 0.5, 2.5) : Math.max(best, heard);
        }
        if (best > 0) scored.push({ row, score: best, at });
    });
    scored.sort((a, b) => b.score - a.score || a.at - b.at);
    const cap = opts.limit ?? (lettersOf(q) <= 2 ? SHORT_SEARCH_CAP : 40);
    return scored.slice(0, cap).map(s => s.row);
}

/** The other names a crop is known by, in this language (search shows why a crop was found). */
export const otherNamesIn = (row: CropMasterRow, language: string | null | undefined): readonly string[] =>
    (language === 'en' ? row.altEn : row.altMr);
