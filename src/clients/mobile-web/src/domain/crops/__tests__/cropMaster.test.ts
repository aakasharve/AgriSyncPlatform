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
