/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18) — the founder's crop master as the app's ONE crop list:
 * every row present, read by MHCR id or by any of its names, searchable by every alternate name, and filtered by
 * the D-25 visibility config (crops on the farm always show).
 */
import { describe, expect, it } from 'vitest';
import { CROP_MASTER_ROWS, CROP_MASTER_SOURCE } from '../cropMasterData';
import {
    ALL_CROPS, CROP_VISIBILITY_POLICY, cropById, cropByName, cropLabel, cropTiles, offerOf, resolveCrop, searchCrops,
} from '../cropMaster';

const ids = (rows: readonly { id: string }[]) => rows.map(r => r.id);

describe('crop master data', () => {
    it('holds all 310 crops, ids unique and in order, each with an English and a Marathi name', () => {
        expect(CROP_MASTER_ROWS).toHaveLength(310);
        expect(CROP_MASTER_SOURCE.rows).toBe(310);
        expect(new Set(ids(CROP_MASTER_ROWS)).size).toBe(310);
        expect(CROP_MASTER_ROWS[0].id).toBe('MHCR-0001');
        expect(CROP_MASTER_ROWS[309].id).toBe('MHCR-0310');
        for (const row of CROP_MASTER_ROWS) {
            expect(row.en, row.id).not.toBe('');
            expect(row.mr, row.id).toMatch(/[ऀ-ॿ]/);
            expect(row.en, row.id).not.toMatch(/[ऀ-ॿ]/);
        }
    });

    it('keeps the sheet\'s visibility counts (D-25 levels)', () => {
        const count = (v: string) => CROP_MASTER_ROWS.filter(r => r.vis === v).length;
        expect([count('core'), count('searchable'), count('review'), count('hidden')]).toEqual([43, 85, 83, 99]);
    });
});

describe('reading a stored crop (never rewritten)', () => {
    it('by MHCR id where known, else by any name in either language', () => {
        expect(cropById('MHCR-0116')?.en).toBe('Grapes');
        for (const stored of ['Grapes', 'grapes', ' Grape ', 'द्राक्ष', 'द्राक्षे', 'Grapevine']) expect(cropByName(stored)?.id, stored).toBe('MHCR-0116');
        expect(cropByName('Sugarcane')?.mr).toBe('ऊस');
        expect(cropByName('Pomegranate')?.mr).toBe('डाळिंब');
        expect(resolveCrop({ masterId: 'MHCR-0058', name: 'something typed' })?.en).toBe('Onion');
    });

    it('a name two different crops share is not read; forms of one crop read as that crop', () => {
        expect(cropByName('ताग')).toBeUndefined(); // Jute and Sunn hemp
        expect(cropByName('मेथी')?.id).toBe('MHCR-0175'); // Fenugreek greens is a form of Fenugreek
        expect(cropByName('माझं नवीन पीक')).toBeUndefined();
    });

    it('shows the canonical name of the language', () => {
        const rice = cropById('MHCR-0001')!;
        expect([cropLabel(rice, 'mr'), cropLabel(rice, 'en')]).toEqual(['भात', 'Rice']);
    });
});

describe('search and visibility (PENDING D-25 default, one config)', () => {
    it('the config is the stated default', () => {
        expect(CROP_VISIBILITY_POLICY).toEqual({ core: 'tile', searchable: 'search', review: 'search', hidden: 'off' });
    });

    it('finds a crop by its English, Marathi or any alternate name', () => {
        expect(ids(searchCrops('Paddy'))[0]).toBe('MHCR-0001');
        expect(ids(searchCrops('तांदूळ'))[0]).toBe('MHCR-0001');
        expect(ids(searchCrops('jowar'))[0]).toBe('MHCR-0003');
        expect(ids(searchCrops('Arhar'))).toContain('MHCR-0017');
        expect(ids(searchCrops('तूर'))[0]).toBe('MHCR-0017');
        expect(ids(searchCrops('grape'))[0]).toBe('MHCR-0116'); // "searchable" level: found by typing
    });

    it('never offers a hidden crop, unless it is already on the farm', () => {
        const hidden = ALL_CROPS.find(r => r.vis === 'hidden')!;
        expect(ids(searchCrops(hidden.en))).not.toContain(hidden.id);
        expect(ids(searchCrops(hidden.en, { onFarm: new Set([hidden.id]) }))).toContain(hidden.id);
        expect(offerOf(hidden)).toBe('off');
        expect(offerOf(hidden, new Set([hidden.id]))).toBe('tile');
    });

    it('a review-level crop is found by typing but is not a tile', () => {
        const review = ALL_CROPS.find(r => r.vis === 'review')!;
        expect(ids(searchCrops(review.mr))).toContain(review.id);
        expect(ids(cropTiles())).not.toContain(review.id);
    });

    it('the tiles are the 43 core crops, plus the farm\'s own crops', () => {
        expect(cropTiles()).toHaveLength(43);
        expect(cropTiles().every(r => r.vis === 'core')).toBe(true);
        expect(ids(cropTiles(new Set(['MHCR-0116'])))).toContain('MHCR-0116');
    });
});

describe('D-25 — a crop appears from 2 typed letters (founder: "2-3 letters, that crop name must appear")', () => {
    const find = (q: string, opts?: Parameters<typeof searchCrops>[1]) => searchCrops(q, opts).map(r => r.en);

    it('Marathi with a matra: "द्रा" finds द्राक्ष first', () => {
        expect(searchCrops('द्रा')[0].mr).toBe('द्राक्ष');
        expect(searchCrops('द्रा', { limit: 5 }).map(r => r.mr)).toContain('द्राक्ष');
    });

    it('a zero-width joiner or non-joiner a phone keyboard may add does not break the match', () => {
        expect(searchCrops('द्‍रा')[0]?.mr).toBe('द्राक्ष');
        expect(searchCrops('ऊ‌')[0]?.mr).toBe('ऊस');
    });

    it('"us" (the way ऊस is said in English letters) finds Sugarcane / ऊस first', () => {
        expect(find('us')[0]).toBe('Sugarcane');
        expect(find('oos')[0]).toBe('Sugarcane');
    });

    it('a local name from the master list: "Cane" (Sugarcane alternate) and the local Marathi "उं" (उंस)', () => {
        expect(find('ca')).toContain('Sugarcane');
        expect(find('cane')[0]).toBe('Sugarcane');
        expect(searchCrops('उं')[0].en).toBe('Sugarcane');
    });

    it('starts-with ranks above contains', () => {
        const mr = searchCrops('द्रा').map(r => r.mr);
        expect(mr.indexOf('द्राक्ष')).toBeLessThan(mr.indexOf('कोद्रा'));
        expect(mr.indexOf('कोद्रा')).toBeGreaterThan(-1);
    });

    it('a short search is capped so it never floods', () => {
        expect(searchCrops('a').length).toBeLessThanOrEqual(20);
        expect(searchCrops('ca').length).toBeLessThanOrEqual(20);
        expect(searchCrops('ca', { limit: 100 }).length).toBeGreaterThan(0);
    });

    it('a hidden crop stays hidden in search, and shows when it is already on the farm', () => {
        const grapefruit = cropById('MHCR-0125')!;
        expect(grapefruit.vis).toBe('hidden');
        expect(find('grapef')).not.toContain('Grapefruit');
        expect(searchCrops('चको').map(r => r.id)).not.toContain('MHCR-0125');
        expect(find('grapef', { onFarm: new Set(['MHCR-0125']) })).toContain('Grapefruit');
        expect(searchCrops('चको', { onFarm: new Set(['MHCR-0125']) }).map(r => r.id)).toContain('MHCR-0125');
    });
});

describe('D-25 fix round 1 - nasal sounds (anusvara) in English letters', () => {
    const ids1 = (q: string, opts?: Parameters<typeof searchCrops>[1]) => searchCrops(q, opts).map(r => r.id);

    it('a consonant before an anusvara keeps its "a": "sa", "san", "santra" find संत्री', () => {
        for (const q of ['sa', 'san', 'santra', 'santri']) expect(ids1(q), q).toContain('MHCR-0120');
        expect(ids1('santra')[0]).toBe('MHCR-0120');
    });

    it('anusvara before a labial is said "m": "amb", "amba" find आंबा; "dalimb", "dalim" find डाळिंब', () => {
        expect(ids1('amba').slice(0, 3)).toContain('MHCR-0114');
        expect(ids1('amb')).toContain('MHCR-0114');
        expect(ids1('dalimb')[0]).toBe('MHCR-0117');
        expect(ids1('dalim')).toContain('MHCR-0117');
    });

    it('"lim" finds कागदी लिंबू; the hidden लिंबू stays hidden unless it is on the farm', () => {
        expect(ids1('lim')).toContain('MHCR-0122');
        expect(ids1('lim')).not.toContain('MHCR-0123');
        expect(ids1('limbu')).not.toContain('MHCR-0123');
        expect(ids1('lim', { onFarm: new Set(['MHCR-0123']) })).toContain('MHCR-0123');
    });
});

describe('D-25 fix round 1 - Devanagari vowel length, aksharas, normName untouched', () => {
    it('"उस" (short u) finds ऊस / Sugarcane; "द्रा" still ranks द्राक्ष first', () => {
        expect(searchCrops('उस').map(r => r.en)).toContain('Sugarcane');
        expect(searchCrops('द्रा')[0].mr).toBe('द्राक्ष');
    });

    it('the short cap counts aksharas: a 2-akshara Devanagari query (4+ code points) gets the short cap', () => {
        const q = 'का'; // 1 akshara, 2 code points
        expect(searchCrops(q).length).toBeLessThanOrEqual(20);
        expect(searchCrops('काक').length).toBeLessThanOrEqual(20); // 2 aksharas, 4 code points
        expect(searchCrops('का').length).toBeGreaterThan(0);
    });

    it('normName is not changed by search: a stored name with a zero-width character is not silently re-resolved', () => {
        expect(cropByName('द्‍राक्ष')).toBeUndefined();
        expect(searchCrops('द्‍रा')[0]?.mr).toBe('द्राक्ष');
    });
});
