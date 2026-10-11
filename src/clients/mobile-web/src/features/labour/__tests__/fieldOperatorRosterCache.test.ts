// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readCachedRoster, writeCachedRoster } from '../data/fieldOperatorRosterCache';

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
});
