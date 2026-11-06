/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-1) — the server reads crop names through the SAME crop master
 * as this phone: `sync-contract/schemas/crop-names.json` (embedded in ShramSafal.Application, read by ScheduleLibrary) is
 * generated from `cropMasterData.ts` by `sync-contract/scripts/generate-crop-names.ts`. This guard fails the moment the two
 * disagree (the founder's sheet regenerated here, the server copy not re-run), so the server can never adopt by an older
 * crop list than the one the phone shows.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CROP_MASTER_ROWS, CROP_MASTER_SOURCE } from '../cropMasterData';

const jsonPath = resolve(__dirname, '../../../../../../../sync-contract/schemas/crop-names.json');
const serverCopy = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
    source: typeof CROP_MASTER_SOURCE;
    rows: Array<{ id: string; en: string; mr: string; altEn: string[]; altMr: string[]; base: string }>;
};

describe("the server's copy of the crop master's names", () => {
    it('comes from the same sheet', () => {
        expect(serverCopy.source).toEqual(CROP_MASTER_SOURCE);
    });

    it('holds every crop, with every name, exactly as the phone does', () => {
        expect(serverCopy.rows).toEqual(
            CROP_MASTER_ROWS.map(r => ({ id: r.id, en: r.en, mr: r.mr, altEn: [...r.altEn], altMr: [...r.altMr], base: r.base })),
        );
    });
});
