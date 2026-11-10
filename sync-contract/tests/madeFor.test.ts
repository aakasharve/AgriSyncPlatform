// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN-c (founder D-137, Q10 = 1; register F224).
// The made-for lists a schedule tag is chosen from live in ONE file, schemas/schedule-made-for.json: the Zod enums are made of it and the server embeds
// it (ShramSafal.Application, MadeForLists). Codes are short ASCII; the Marathi / English labels are DATA for the phone (part b), never codes. The
// varieties are the phone's own catalog (varietyCatalog.ts) keyed by the phone's crop CODE, minus "Other"; `_other` (Local, Hybrid) is for a crop
// without a list. The lists are PROPOSED, unchecked by an agronomist (F224).
import { describe, expect, it } from 'vitest';
import lists from '../schemas/schedule-made-for.json';
import { ZClimate, ZRegion, ZSoilType, ZVariety } from '../schemas/payloads/_madeFor.zod';

const CODE = /^[a-z][a-z0-9_]*$/;

describe('schedule-made-for.json', () => {
    it('is version 1 and names its three code lists', () => {
        expect(lists.version).toBe(1);
        expect(Object.keys(lists).sort()).toEqual(['climate', 'labelsEn', 'labelsMr', 'region', 'soilType', 'variety', 'version']);
    });

    it('holds 1..8 short ASCII codes per list, no duplicates', () => {
        for (const name of ['soilType', 'climate', 'region'] as const) {
            const list = lists[name];
            expect(list.length, name).toBeGreaterThanOrEqual(1);
            expect(list.length, name).toBeLessThanOrEqual(8);
            expect(new Set(list).size, name).toBe(list.length);
            for (const code of list) expect(code, `${name}: ${code}`).toMatch(CODE);
        }
        expect(lists.soilType).toEqual(['black', 'red', 'medium', 'murum', 'sandy']);
        expect(lists.climate).toEqual(['dry', 'humid', 'cold', 'hot', 'heavy_rain']);
        expect(lists.region).toEqual(['mh', 'mh_nashik', 'mh_solapur', 'mh_pune', 'mh_sangli', 'mh_satara']);
    });

    it('keys the varieties by exactly the phone crop codes, each value 1..40 characters and never Other', () => {
        expect(Object.keys(lists.variety).sort()).toEqual(['_other', 'grape', 'onion', 'pomegranate', 'tomato']);
        for (const [crop, values] of Object.entries(lists.variety)) {
            expect(values.length, crop).toBeGreaterThanOrEqual(1);
            expect(new Set(values).size, crop).toBe(values.length);
            for (const v of values) {
                expect(v.length, `${crop}: ${v}`).toBeGreaterThanOrEqual(1);
                expect(v.length, `${crop}: ${v}`).toBeLessThanOrEqual(40);
                expect(v, crop).not.toBe('Other');
            }
        }
        expect(lists.variety.grape).toEqual(['Super Sonaka', 'Sharad Seedless', 'Thompson Seedless', 'Crimson Seedless', 'Flame Seedless', 'Manik Chaman']);
        expect(lists.variety.pomegranate).toEqual(['Bhagwa', 'Ganesh', 'Mridula', 'Arakta']);
        expect(lists.variety.tomato).toEqual(['Abhinav', 'Shivam', 'Arka Rakshak']);
        expect(lists.variety.onion).toEqual(['Nashik Red', 'Puna Fursungi', 'N-53']);
        expect(lists.variety._other).toEqual(['Local', 'Hybrid']);
    });

    it('carries a Marathi and an English label for every soil, climate and region code, and for nothing else', () => {
        for (const name of ['soilType', 'climate', 'region'] as const) {
            const codes = [...lists[name]].sort();
            expect(Object.keys(lists.labelsMr[name]).sort(), `labelsMr.${name}`).toEqual(codes);
            expect(Object.keys(lists.labelsEn[name]).sort(), `labelsEn.${name}`).toEqual(codes);
            for (const code of codes) {
                expect((lists.labelsMr[name] as Record<string, string>)[code].length).toBeGreaterThan(0);
                expect((lists.labelsEn[name] as Record<string, string>)[code].length).toBeGreaterThan(0);
            }
        }
    });

    it('is exactly what the Zod enums are made of', () => {
        expect(ZSoilType.options).toEqual(lists.soilType);
        expect(ZClimate.options).toEqual(lists.climate);
        expect(ZRegion.options).toEqual(lists.region);
        const union = [...new Set(Object.values(lists.variety).flat())];
        expect([...ZVariety.options].sort()).toEqual(union.sort());
        expect(ZVariety.safeParse('Other').success).toBe(false);
        expect(ZSoilType.safeParse('काळी').success).toBe(false);
    });
});
