/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S0 phone half + S5) - the phone's village list is the SAME data as the
 * server's (byte for byte, same version string), it holds together, and the type-ahead finds places the way the contract says. The search speed
 * on the full list is MEASURED here and printed (not predicted).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLACE_LIST_VERSION, PlaceListError, parsePlaceList } from '../placeList';
import { buildPlaceIndex, searchDistricts, searchTalukas, searchVillages, villageByCode } from '../placeSearch';

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const PHONE_TSV = at('../../../../public/places/lgd-mh-2026-11-26.tsv');
const PHONE_JSON = at('../../../../public/places/lgd-mh-2026-11-26-areas.json');
const SERVER_DIR = '../../../../../../apps/User/User.Infrastructure/Places/';
const SERVER_TSV = at(`${SERVER_DIR}lgd-mh-2026-11-26.tsv`);
const SERVER_JSON = at(`${SERVER_DIR}lgd-mh-2026-11-26-areas.json`);
const SERVER_LIST_CS = at(`${SERVER_DIR}LgdPlaceList.cs`);

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const tsv = readFileSync(PHONE_TSV, 'utf8');
const json = readFileSync(PHONE_JSON, 'utf8');
const list = parsePlaceList(tsv, json);
const index = buildPlaceIndex(list);

describe('the phone holds the server\'s village list', () => {
    it('byte for byte the server\'s two files', () => {
        expect(sha(PHONE_TSV)).toBe(sha(SERVER_TSV));
        expect(sha(PHONE_JSON)).toBe(sha(SERVER_JSON));
    });

    it('with the same version string as the server (LgdPlaceList.CurrentVersion)', () => {
        const cs = readFileSync(SERVER_LIST_CS, 'utf8');
        expect(cs).toContain(`public const string CurrentVersion = "${PLACE_LIST_VERSION}";`);
        expect(list.version).toBe(PLACE_LIST_VERSION);
        expect(PLACE_LIST_VERSION).toBe('lgd-mh-2026-11-26');
    });

    it('holds 44,930 villages, 358 talukas, 35 districts; 42 without a Marathi name, 125 without a PIN; nothing filled in', () => {
        expect(list.villages).toHaveLength(44930);
        expect(list.talukas.size).toBe(358);
        expect(list.districts.size).toBe(35);
        expect(list.villages.filter(v => v.nameMr === null)).toHaveLength(42);
        expect(list.villages.filter(v => v.pin === null)).toHaveLength(125);
        const by = (s: string) => list.villages.filter(v => v.status === s).length;
        expect([by('I'), by('U'), by('F')]).toEqual([44605, 320, 5]);
        // No taluka carries a Marathi name (founder question 8 open): the type has none to invent.
        expect([...list.talukas.values()].every(t => !('nameMr' in t))).toBe(true);
    });

    it('refuses a list that does not hold the counts its first line names, with words', () => {
        const short = tsv.split('\n').slice(0, -3).join('\n');
        expect(() => parsePlaceList(short, json)).toThrow(PlaceListError);
        expect(() => parsePlaceList(short, json)).toThrow('the list does not hold the counts its first line names');
        expect(() => parsePlaceList(tsv, json.replace(PLACE_LIST_VERSION, 'lgd-mh-1999-01-01'))).toThrow('the areas file is of another list version');
        expect(() => parsePlaceList(tsv.replace(/\n/g, '\r\n'), json).villages.length).not.toThrow();
    });
});

describe('the village type-ahead', () => {
    it('"पंढ" (Marathi letters) shows पंढरपूर of taluka Pandharpur, district सोलापूर', () => {
        const hits = searchVillages(index, 'पंढ');
        const hit = hits.find(h => h.village.code === 944182);
        expect(hit?.village.nameMr).toBe('पंढरपूर');
        expect(hit?.taluka.nameEn).toBe('Pandharpur');
        expect(hit?.district.nameMr).toBe('सोलापूर');
    });

    it('"pandh" (English letters) matches the English names: 8 rows of many; "pandharpur" and Solapur district find it', () => {
        expect(searchVillages(index, 'pandh')).toHaveLength(8);
        expect(searchVillages(index, 'pandharpur', { limit: 20 }).map(h => h.village.code)).toContain(944182);
        const solapur = [...list.districts.values()].find(d => d.nameEn === 'Solapur')!;
        expect(searchVillages(index, 'pandh', { districtCode: solapur.code }).map(h => h.village.code)).toContain(944182);
    });

    it('"चिखली" shows rows from different talukas (the same name in 57 places)', () => {
        const hits = searchVillages(index, 'चिखली', { limit: 57 });
        expect(new Set(hits.filter(h => h.village.nameMr === 'चिखली').map(h => h.taluka.code)).size).toBeGreaterThan(1);
    });

    it('a later word counts: "भोसे" finds "चिंचोली भोसे", after the names that start with it', () => {
        const hits = searchVillages(index, 'भोसे', { limit: 50 });
        const names = hits.map(h => h.village.nameMr);
        expect(names).toContain('चिंचोली भोसे');
        expect(names.indexOf('भोसे')).toBeLessThan(names.indexOf('चिंचोली भोसे'));
    });

    it('a chosen taluka narrows the villages', () => {
        const hits = searchVillages(index, 'पं', { talukaCode: 4249, limit: 100 });
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every(h => h.taluka.code === 4249)).toBe(true);
    });

    it('one letter is not enough; a query in neither script finds nothing', () => {
        expect(searchVillages(index, 'प')).toEqual([]);
        expect(searchVillages(index, '12')).toEqual([]);
    });

    it('the 42 villages without a Marathi name are found by English letters and keep no Marathi name', () => {
        const hits = searchVillages(index, 'navin ashti');
        expect(hits[0]?.village.nameEn).toBe('Navin Ashti');
        expect(hits[0]?.village.nameMr).toBeNull();
    });

    it('talukas: English letters only (no Marathi names exist); districts: either script', () => {
        expect(searchTalukas(index, 'पंढ')).toEqual([]);
        expect(searchTalukas(index, 'pandh').map(t => t.code)).toContain(4249);
        expect(searchDistricts(index, 'सोला')[0]?.nameEn).toBe('Solapur');
        expect(searchDistricts(index, 'sola')[0]?.nameMr).toBe('सोलापूर');
    });

    it('a saved village code finds its taluka and district again', () => {
        expect(villageByCode(index, 944182)?.district.nameEn).toBe('Solapur');
        expect(villageByCode(index, 1)).toBeNull();
    });

    it('MEASURED on the full list: parse + index time, and the time of one search (printed for the report)', () => {
        const t0 = performance.now();
        const fresh = buildPlaceIndex(parsePlaceList(tsv, json));
        const t1 = performance.now();
        const queries = ['पं', 'पंढ', 'चिखली', 'भोसे', 'pa', 'pandh', 'shir', 'नवी'];
        const runs = 5;
        const times: number[] = [];
        for (let r = 0; r < runs; r += 1) {
            for (const q of queries) {
                const s = performance.now();
                searchVillages(fresh, q);
                times.push(performance.now() - s);
            }
        }
        times.sort((a, b) => a - b);
        const median = times[Math.floor(times.length / 2)];
        const worst = times[times.length - 1];
        console.log(`[IDENT S5 measured] parse+index ${(t1 - t0).toFixed(1)} ms; one village search over ${fresh.entries.length} rows: median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms (${times.length} searches)`);
        expect(fresh.entries).toHaveLength(44930);
    });
});
