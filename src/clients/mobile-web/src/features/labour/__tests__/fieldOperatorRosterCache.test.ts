// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readCachedRoster, writeCachedRoster } from '../data/fieldOperatorRosterCache';
import { LABOUR_READOUT_MAX_AGE_MS, writeLabourReadout } from '../../../infrastructure/storage/LabourReadoutCache';
import { purgeExpiredLabourCaches } from '../../../infrastructure/storage/labourFarmAccess';

const OP = { id: 'a1', displayName: 'रमेश', isActive: true };

afterEach(() => window.localStorage.clear());

describe('fieldOperatorRosterCache', () => {
    it('round-trips a roster per farm', () => {
        writeCachedRoster('farm-1', [OP]);
        expect(readCachedRoster('farm-1')).toEqual([OP]);
    });

    it('never shows one farm\'s names on another', () => {
        writeCachedRoster('farm-1', [OP]);
        expect(readCachedRoster('farm-2')).toBeNull();
    });

    it('corrupt or wrong-shaped storage is "no cache", not a crash', () => {
        for (const bad of ['not json', '{"a":1}', '[{"id":1}]']) {
            window.localStorage.clear();
            writeCachedRoster('farm-1', [OP]);
            const key = Object.keys(window.localStorage).find((k) => k.includes('farm-1'))!;
            window.localStorage.setItem(key, bad);
            expect(readCachedRoster('farm-1')).toBeNull();
        }
    });

    // Founder 2026-10-12: Labour names are cached for at most 7 days, and the
    // roster is a Labour-names cache just like the read-out.
    const rosterKey = () => Object.keys(window.localStorage).find((k) => k.includes('field_operator_roster_farm-1'))!;
    const age = (ms: number) => {
        const rec = JSON.parse(window.localStorage.getItem(rosterKey())!);
        rec.savedAtUtc = new Date(Date.now() - ms).toISOString();
        window.localStorage.setItem(rosterKey(), JSON.stringify(rec));
    };

    it('a roster older than 7 days is not shown and is deleted on read', () => {
        writeCachedRoster('farm-1', [OP]);
        age(LABOUR_READOUT_MAX_AGE_MS + 3600_000);
        const key = rosterKey();
        expect(readCachedRoster('farm-1')).toBeNull();
        expect(window.localStorage.getItem(key)).toBeNull();
    });

    it('a roster just inside 7 days is still shown', () => {
        writeCachedRoster('farm-1', [OP]);
        age(LABOUR_READOUT_MAX_AGE_MS - 3600_000);
        expect(readCachedRoster('farm-1')).toEqual([OP]);
    });

    it('a legacy roster with no timestamp has unknown age: not shown, deleted', () => {
        writeCachedRoster('farm-1', [OP]);
        const key = rosterKey();
        window.localStorage.setItem(key, JSON.stringify([OP]));
        expect(readCachedRoster('farm-1')).toBeNull();
        expect(window.localStorage.getItem(key)).toBeNull();
    });

    it('the boot sweep purges expired read-outs and rosters that nobody reads, and keeps fresh ones', () => {
        writeLabourReadout('u1', 'old-farm', 'alltime', { a: 1 });
        writeLabourReadout('u1', 'new-farm', 'alltime', { a: 1 });
        writeCachedRoster('farm-1', [OP]);
        writeCachedRoster('farm-2', [OP]);
        const stale = Date.now() - LABOUR_READOUT_MAX_AGE_MS - 3600_000;
        for (const k of Object.keys(window.localStorage)) {
            if (k.includes('old-farm') || k.includes('roster_farm-1')) {
                const rec = JSON.parse(window.localStorage.getItem(k)!);
                rec.savedAtUtc = new Date(stale).toISOString();
                window.localStorage.setItem(k, JSON.stringify(rec));
            }
        }
        purgeExpiredLabourCaches();
        const keys = Object.keys(window.localStorage);
        expect(keys.some((k) => k.includes('old-farm'))).toBe(false);
        expect(keys.some((k) => k.includes('roster_farm-1'))).toBe(false);
        expect(keys.some((k) => k.includes('new-farm'))).toBe(true);
        expect(keys.some((k) => k.includes('roster_farm-2'))).toBe(true);
    });
});
