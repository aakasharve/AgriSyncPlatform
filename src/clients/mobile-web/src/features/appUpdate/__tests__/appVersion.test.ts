/**
 * Lane UPD-1 — app versions compare as NUMBERS, part by part, and anything malformed never prompts.
 */
import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, parseVersion } from '../appVersion';

describe('app version compare (UPD-1)', () => {
    it('1.0.10 is newer than 1.0.9 (a text compare gets this wrong)', () => {
        expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
        expect(compareVersions('1.0.9', '1.0.10')).toBe(-1);
        expect(isNewerVersion('1.0.10', '1.0.9')).toBe(true);
        expect(isNewerVersion('1.0.9', '1.0.10')).toBe(false);
    });

    it('equal versions are not newer; a missing part counts as 0', () => {
        expect(compareVersions('1.0.17', '1.0.17')).toBe(0);
        expect(isNewerVersion('1.0.17', '1.0.17')).toBe(false);
        expect(compareVersions('1.0', '1.0.0')).toBe(0);
        expect(compareVersions('2', '1.99.99')).toBe(1);
        expect(compareVersions(' 1.0.18 ', '1.0.17')).toBe(1);
    });

    it.each(['1.0.x', 'v1.0.18', '1..0', '1.0.18-beta', '', '1.0.0.0.1', '123456.0'])('"%s" is malformed: no compare, no prompt', bad => {
        expect(parseVersion(bad)).toBeNull();
        expect(compareVersions(bad, '1.0.0')).toBeNull();
        expect(isNewerVersion(bad, '1.0.0')).toBe(false);
        expect(isNewerVersion('9.9.9', bad)).toBe(false);
    });

    it('non-text (null, a number, an object) is malformed too', () => {
        for (const bad of [null, undefined, 1.1, {}, ['1', '0']]) {
            expect(parseVersion(bad)).toBeNull();
            expect(isNewerVersion(bad, '1.0.0')).toBe(false);
        }
    });
});
