/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S5) - the type-ahead over the government village list, on the phone, with no
 * network: two or three letters, in Marathi letters (matched against the Marathi names) or English letters (matched against the English names).
 *
 *   - A name that STARTS with the letters comes first, then a name where a later WORD starts with them ("भोसे" finds "चिंचोली भोसे").
 *   - Inside each, lived-in villages before not-lived-in and forest ones; all are kept (P9: never reject a real place).
 *   - A chosen taluka narrows the villages; a chosen district narrows the talukas and the villages.
 *   - Talukas have English names only (founder question 8 is open): Marathi letters find no taluka, and nothing here invents a Marathi one.
 *
 * Pure: no network, no storage, no clock. The screen decides how a row reads.
 */
import type { PlaceDistrict, PlaceList, PlaceTaluka, PlaceVillage } from './placeList';

/** Letters typed before the list is searched. */
export const MIN_QUERY_LENGTH = 2;
/** Rows a box shows at most. */
export const DEFAULT_LIMIT = 8;

export type QueryScript = 'deva' | 'latn' | 'none';

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;
const JOINERS = /[‌‍]/g;
const SEPARATORS = new Set([' ', '-', '(', ')', '.', '/', ',']);

/** Which names a query is matched against: Marathi letters → Marathi names, English letters → English names. */
export function queryScriptOf(query: string): QueryScript {
    if (DEVANAGARI.test(query)) return 'deva';
    if (LATIN.test(query)) return 'latn';
    return 'none';
}

/** The form both a name and a query are compared in (NFC, no joiners, one space; English in small letters). */
export function normalizeForSearch(text: string, script: QueryScript): string {
    const t = text.normalize('NFC').replace(JOINERS, '').replace(/\s+/g, ' ').trim();
    return script === 'latn' ? t.toLowerCase() : t;
}

interface Searchable {
    text: string;
    /** Where every later word starts (the first word starts at 0). */
    wordStarts: number[];
}

function searchable(text: string, script: QueryScript): Searchable {
    const t = normalizeForSearch(text, script);
    const wordStarts: number[] = [];
    for (let i = 1; i < t.length; i += 1) {
        if (SEPARATORS.has(t[i - 1]) && !SEPARATORS.has(t[i])) wordStarts.push(i);
    }
    return { text: t, wordStarts };
}

/** 0: the name starts with the query; 1: a later word does; -1: no match. */
function matchRank(s: Searchable | null, q: string): number {
    if (!s) return -1;
    if (s.text.startsWith(q)) return 0;
    for (const i of s.wordStarts) if (s.text.startsWith(q, i)) return 1;
    return -1;
}

const STATUS_RANK: Record<PlaceVillage['status'], number> = { I: 0, U: 1, F: 2 };

interface VillageEntry {
    village: PlaceVillage;
    taluka: PlaceTaluka;
    district: PlaceDistrict;
    mr: Searchable | null;
    en: Searchable;
}

export interface PlaceIndex {
    list: PlaceList;
    entries: VillageEntry[];
    talukas: { taluka: PlaceTaluka; en: Searchable }[];
    districts: { district: PlaceDistrict; mr: Searchable; en: Searchable }[];
}

export interface VillageHit {
    village: PlaceVillage;
    taluka: PlaceTaluka;
    district: PlaceDistrict;
}

/** Builds the search index once per page visit (the caller measures and drops it). */
export function buildPlaceIndex(list: PlaceList): PlaceIndex {
    const entries: VillageEntry[] = [];
    for (const village of list.villages) {
        const taluka = list.talukas.get(village.talukaCode);
        const district = taluka ? list.districts.get(taluka.districtCode) : undefined;
        if (!taluka || !district) continue; // parsePlaceList already refused such a list
        entries.push({
            village, taluka, district,
            mr: village.nameMr ? searchable(village.nameMr, 'deva') : null,
            en: searchable(village.nameEn, 'latn'),
        });
    }
    const talukas = [...list.talukas.values()].map(taluka => ({ taluka, en: searchable(taluka.nameEn, 'latn') }));
    const districts = [...list.districts.values()].map(district => ({
        district, mr: searchable(district.nameMr, 'deva'), en: searchable(district.nameEn, 'latn'),
    }));
    return { list, entries, talukas, districts };
}

function ready(query: string): { q: string; script: QueryScript } | null {
    const script = queryScriptOf(query);
    if (script === 'none') return null;
    const q = normalizeForSearch(query, script);
    return q.length >= MIN_QUERY_LENGTH ? { q, script } : null;
}

export interface VillageSearchOptions {
    talukaCode?: number | null;
    districtCode?: number | null;
    limit?: number;
}

/** The villages whose name (in the query's script) starts with, or has a word starting with, the query. */
export function searchVillages(index: PlaceIndex, query: string, opts: VillageSearchOptions = {}): VillageHit[] {
    const r = ready(query);
    if (!r) return [];
    const hits: { e: VillageEntry; rank: number }[] = [];
    for (const e of index.entries) {
        if (opts.talukaCode != null && e.taluka.code !== opts.talukaCode) continue;
        if (opts.districtCode != null && e.district.code !== opts.districtCode) continue;
        const rank = matchRank(r.script === 'deva' ? e.mr : e.en, r.q);
        if (rank >= 0) hits.push({ e, rank });
    }
    hits.sort((a, b) => a.rank - b.rank
        || STATUS_RANK[a.e.village.status] - STATUS_RANK[b.e.village.status]
        || (r.script === 'deva' ? (a.e.mr?.text.length ?? 0) - (b.e.mr?.text.length ?? 0) : a.e.en.text.length - b.e.en.text.length)
        || a.e.village.code - b.e.village.code);
    return hits.slice(0, opts.limit ?? DEFAULT_LIMIT).map(({ e }) => ({ village: e.village, taluka: e.taluka, district: e.district }));
}

/** Talukas by their English name (the only name the list has). Marathi letters find none. */
export function searchTalukas(index: PlaceIndex, query: string, opts: { districtCode?: number | null; limit?: number } = {}): PlaceTaluka[] {
    const r = ready(query);
    if (!r || r.script !== 'latn') return [];
    return index.talukas
        .filter(t => opts.districtCode == null || t.taluka.districtCode === opts.districtCode)
        .map(t => ({ t, rank: matchRank(t.en, r.q) }))
        .filter(x => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.t.en.text.length - b.t.en.text.length || a.t.taluka.code - b.t.taluka.code)
        .slice(0, opts.limit ?? DEFAULT_LIMIT)
        .map(x => x.t.taluka);
}

/** Districts by their Marathi or English name. */
export function searchDistricts(index: PlaceIndex, query: string, opts: { limit?: number } = {}): PlaceDistrict[] {
    const r = ready(query);
    if (!r) return [];
    return index.districts
        .map(d => ({ d, rank: matchRank(r.script === 'deva' ? d.mr : d.en, r.q) }))
        .filter(x => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.d.district.code - b.d.district.code)
        .slice(0, opts.limit ?? DEFAULT_LIMIT)
        .map(x => x.d.district);
}

/** The village, its taluka and its district by the village's code (a saved card's village), or null. */
export function villageByCode(index: PlaceIndex, code: number): VillageHit | null {
    const e = index.entries.find(x => x.village.code === code);
    return e ? { village: e.village, taluka: e.taluka, district: e.district } : null;
}
