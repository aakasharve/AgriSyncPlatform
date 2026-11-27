/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S5) - the bundled list is read once per page visit (the same promise for every
 * box), dropped when the page closes, and a list that cannot be read is a plain failure (the boxes then keep what he types).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPlaceData, releasePlaceData } from '../placeData';

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const files = {
    tsv: readFileSync(at('../../../../public/places/lgd-mh-2026-11-26.tsv'), 'utf8'),
    areas: readFileSync(at('../../../../public/places/lgd-mh-2026-11-26-areas.json'), 'utf8'),
};

afterEach(() => { releasePlaceData(); });

describe('loadPlaceData', () => {
    it('reads the files once and builds the village index and the Marathi word list', async () => {
        const source = vi.fn(async () => files);
        const [a, b] = await Promise.all([loadPlaceData(source), loadPlaceData(source)]);
        expect(source).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
        expect(a.index.entries).toHaveLength(44930);
        expect(a.words.size).toBe(25762);
    });

    it('released when the page closes: the next visit reads again', async () => {
        const source = vi.fn(async () => files);
        await loadPlaceData(source);
        releasePlaceData();
        await loadPlaceData(source);
        expect(source).toHaveBeenCalledTimes(2);
    });

    it('a file that cannot be read is a failure, and a later try may succeed', async () => {
        await expect(loadPlaceData(async () => { throw new Error('404'); })).rejects.toThrow();
        await expect(loadPlaceData(async () => ({ tsv: 'garbage', areas: '{}' }))).rejects.toThrow();
        await expect(loadPlaceData(async () => files)).resolves.toBeTruthy();
    });
});
